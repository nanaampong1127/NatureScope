"""Species Classifier with intelligent routing

Uses PyTorch to classify images as plant or animal, then routes to:
- Plants: PlantNet API (if available)
- Animals: Google Cloud Vision API

Falls back to Google Cloud Vision for any image.
"""

import requests
from typing import Dict, Optional
import os

try:
    from . import pytorch_identifier
    PYTORCH_AVAILABLE = True
except ImportError:
    try:
        import pytorch_identifier
        PYTORCH_AVAILABLE = True
    except ImportError:
        PYTORCH_AVAILABLE = False
        print("[DEBUG] PyTorch identifier not available")


def classify_from_url(image_url: str) -> Dict:
    """Classify species from an image URL.
    
    Args:
        image_url: URL of the image to classify
        
    Returns:
        dict with keys: label, confidence, source, error
    """
    print(f"[INFO] Classifying image from URL: {image_url}")
    
    # Download the image
    try:
        headers = {"User-Agent": "NatureScope/1.0"}
        response = requests.get(image_url, headers=headers, timeout=15)
        
        if response.status_code != 200:
            return {
                "label": None,
                "confidence": None,
                "source": None,
                "error": f"Failed to download image: {response.status_code}"
            }
        
        image_bytes = response.content
        print(f"[INFO] Downloaded {len(image_bytes)} bytes")
        
    except Exception as e:
        return {
            "label": None,
            "confidence": None,
            "source": None,
            "error": f"Failed to download image: {str(e)}"
        }
    
    # Classify the downloaded image
    return classify_image(image_bytes)


def classify_image(image_bytes: bytes) -> Dict:
    """Classify species from image bytes.
    
    Strategy:
    1. Use PyTorch to detect if image is plant or animal
    2. Route plants to PlantNet API (if available)
    3. Route animals to Google Cloud Vision
    
    Args:
        image_bytes: Raw image data as bytes
        
    Returns:
        dict with species classification and confidence
    """
    print(f"[INFO] Classifying image ({len(image_bytes)} bytes)")
    
    # Step 1: Detect if plant or animal
    category = None
    if PYTORCH_AVAILABLE:
        try:
            print(f"[INFO] Running PyTorch plant/animal identifier...")
            pytorch_result = pytorch_identifier.classify_image_source(image_bytes)
            category = pytorch_result.get('decision')
            print(f"[INFO] PyTorch detected: {category} ({pytorch_result.get('confidence', 0):.2%} confidence)")
        except Exception as e:
            print(f"[DEBUG] PyTorch identifier failed: {e}")
    
    # Step 2: Route to specialized classifier based on category
    if category == 'plant':
        print(f"[INFO] Routing to PlantNet for plant classification...")
        result = _try_plantnet(image_bytes)
        if result:
            return result
        # Fallback to Google Vision if PlantNet unavailable
        print(f"[INFO] PlantNet unavailable, falling back to Google Cloud Vision...")
    elif category == 'animal':
        print(f"[INFO] Routing to Google Cloud Vision for animal classification...")
        result = _try_google_vision(image_bytes)
        if result:
            return result
    
    # Step 3: Fallback - if no category detected or both failed, try Google Vision
    print(f"[INFO] Trying Google Cloud Vision API...")
    result = _try_google_vision(image_bytes)
    if result:
        return result
    
    # Return failure
    print(f"[ERROR] Classification failed")
    return {
        "label": None,
        "confidence": None,
        "source": None,
        "error": "No classification provider could classify the image"
    }


def _try_google_vision(image_bytes: bytes) -> Optional[Dict]:
    """Try Google Cloud Vision API for label detection.

    Requires Google credentials via `GOOGLE_APPLICATION_CREDENTIALS` environment
    variable pointing to a service account JSON file.
    """
    try:
        try:
            from google.cloud import vision
        except ImportError as e:
            print(f"[DEBUG] google-cloud-vision not available: {e}")
            return None

        # Allow client to pick up credentials from environment
        client = vision.ImageAnnotatorClient()
        image = vision.Image(content=image_bytes)

        # Try label detection first (basic classification)
        print(f"[INFO] Running label detection...")
        response = client.label_detection(image=image, max_results=10)
        if response.error.message:
            print(f"[DEBUG] Label detection error: {response.error.message}")
        else:
            labels = response.label_annotations
            if labels and len(labels) > 0:
                top = labels[0]
                desc = top.description
                score = getattr(top, 'score', None) or getattr(top, 'confidence', None) or 0.0
                try:
                    score = float(score)
                except Exception:
                    score = 0.0

                print(f"[INFO] Top label: {desc} ({score:.2%})")

                # Gather candidate labels (top labels + web entities) and prioritize specific ones
                candidates = [l.description for l in labels[:5]]
                generic_stopwords = set(['bird', 'animal', 'plant', 'flower', 'tree', 'mammal', 'insect', 'organism', 'vertebrate', 'wildlife', 'beak', 'feather', 'nature'])
                specific_candidates = [c for c in candidates if c and c.lower() not in generic_stopwords]
                candidates = specific_candidates + [c for c in candidates if c not in specific_candidates]

                # Try web detection to gather additional candidate strings
                try:
                    web_resp = client.web_detection(image=image)
                    if getattr(web_resp, 'best_guess_labels', None):
                        bgl = web_resp.best_guess_labels
                        if len(bgl) > 0:
                            bg_label = getattr(bgl[0], 'label', None) or getattr(bgl[0], 'best_guess', None)
                            if bg_label and bg_label not in candidates:
                                candidates.append(bg_label)
                    if getattr(web_resp, 'web_entities', None):
                        for e in (web_resp.web_entities or [])[:5]:
                            desc_e = getattr(e, 'description', None)
                            if desc_e and desc_e not in candidates:
                                candidates.append(desc_e)
                except Exception:
                    pass

                # Build base result
                additional_details = _get_additional_vision_details(client, image)
                result = {
                    "label": desc,
                    "confidence": float(score),
                    "source": "google_vision_labels",
                    "error": None,
                    "all_labels": [{"description": l.description, "score": float(getattr(l, 'score', 0.0))} for l in labels[:5]],
                    "additional_details": additional_details
                }

                # If labels look plant-like, try PlantNet first (more accurate for plants)
                plant_keywords = set(['plant', 'flower', 'tree', 'leaf', 'fern', 'moss', 'fungus', 'mushroom', 'bloom', 'rose', 'orchid'])
                any_plant = any((l and any(k in l.lower() for k in plant_keywords)) for l in candidates)
                if any_plant:
                    plantnet_result = _try_plantnet(image_bytes)
                    if plantnet_result:
                        # merge additional details if Google provided some
                        try:
                            if 'additional_details' in additional_details:
                                plantnet_result.setdefault('additional_details', {}).update(additional_details)
                        except Exception:
                            pass
                        return plantnet_result

                # Try to enrich candidates via Wikipedia/Wikidata and prefer scientific name when found
                chosen_enrichment = None
                for candidate in candidates:
                    try:
                        enrich = _enrich_with_wikipedia(candidate)
                        if not enrich:
                            continue
                        sci = enrich.get('scientific_name')
                        title = enrich.get('page_title', '')
                        if sci:
                            chosen_enrichment = enrich
                            break
                        if title and (' ' in title or '(' in title):
                            chosen_enrichment = enrich
                            break
                        if not chosen_enrichment:
                            chosen_enrichment = enrich
                    except Exception:
                        continue

                if chosen_enrichment:
                    # If scientific name found, prefer it for display label
                    sci = chosen_enrichment.get('scientific_name')
                    title = chosen_enrichment.get('page_title')
                    if sci:
                        result['label'] = f"{sci} ({title})" if title else sci
                    elif title:
                        result['label'] = title
                    result['enrichment'] = chosen_enrichment
                    result['source'] = 'google_vision + wikipedia'

                return result

        # Try object localization as fallback (can detect multiple objects)
        print(f"[INFO] Running object localization...")
        object_resp = client.object_localization(image=image)
        localized_objects = getattr(object_resp, 'localized_object_annotations', [])
        if localized_objects and len(localized_objects) > 0:
            obj = localized_objects[0]
            obj_name = obj.name
            obj_score = getattr(obj, 'score', 0.5)
            print(f"[INFO] Detected object: {obj_name} ({obj_score:.2%})")
            return {
                "label": obj_name,
                "confidence": float(obj_score),
                "source": "google_vision_objects",
                "error": None,
                "all_objects": [{"name": o.name, "score": float(getattr(o, 'score', 0.0)), "vertices": str(o.bounding_poly.normalized_vertices)[:100]} for o in localized_objects[:5]]
            }

        # Try landmark detection
        print(f"[INFO] Running landmark detection...")
        landmark_resp = client.landmark_detection(image=image)
        if landmark_resp.landmark_annotations and len(landmark_resp.landmark_annotations) > 0:
            landmark = landmark_resp.landmark_annotations[0]
            name = landmark.description
            score = getattr(landmark, 'score', 0.5)
            print(f"[INFO] Detected landmark: {name} ({score:.2%})")
            return {
                "label": name,
                "confidence": float(score),
                "source": "google_vision_landmark",
                "error": None,
                "location": str(landmark.locations) if landmark.locations else None
            }

        # Try web detection as fallback
        print(f"[INFO] Running web detection...")
        web_resp = client.web_detection(image=image)
        if getattr(web_resp, 'error', None) and getattr(web_resp.error, 'message', None):
            print(f"[DEBUG] Web detection error: {web_resp.error.message}")
        else:
            best = getattr(web_resp, 'best_guess_labels', None)
            if best and len(best) > 0:
                bg = best[0]
                label = getattr(bg, 'label', None) or getattr(bg, 'best_guess', None) or None
                if label:
                    print(f"[INFO] Web best guess: {label}")
                    return {
                        "label": label,
                        "confidence": 0.5,
                        "source": "google_vision_web",
                        "error": None,
                        "web_entities": [{"description": e.description, "score": float(getattr(e, 'score', 0.0))} for e in (getattr(web_resp, 'web_entities', [])[:5])]
                    }

    except Exception as e:
        import traceback
        print(f"[DEBUG] Google Vision exception: {type(e).__name__}: {e}")
        traceback.print_exc()

    return None


def _get_additional_vision_details(client, image) -> Dict:
    """Get additional details like colors, text, landmarks for richer results."""
    try:
        details = {}
        
        # Get image properties (dominant colors)
        print(f"[DEBUG] Getting image properties...")
        props_resp = client.image_properties(image=image)
        img_props = getattr(props_resp, 'image_properties_annotation', None)
        if img_props and img_props.dominant_colors:
            colors = []
            for color_info in img_props.dominant_colors.colors[:3]:
                rgb = color_info.color
                hex_color = '#%02x%02x%02x' % (int(rgb.red), int(rgb.green), int(rgb.blue))
                colors.append({
                    "hex": hex_color,
                    "pixel_fraction": float(getattr(color_info, 'pixel_fraction', 0.0)),
                    "score": float(getattr(color_info, 'score', 0.0))
                })
            details["dominant_colors"] = colors
        
        # Get any text in the image (for species labels on signs, etc.)
        print(f"[DEBUG] Getting text detection...")
        text_resp = client.text_detection(image=image)
        if text_resp.text_annotations and len(text_resp.text_annotations) > 0:
            all_text = text_resp.text_annotations[0].description
            details["detected_text"] = all_text[:200] if len(all_text) > 200 else all_text
        
        # Get object localization for multiple detections
        print(f"[DEBUG] Getting all objects...")
        objects_resp = client.object_localization(image=image)
        localized_objects = getattr(objects_resp, 'localized_object_annotations', [])
        if localized_objects:
            objects = [{"name": o.name, "score": float(getattr(o, 'score', 0.0))} for o in localized_objects[:5]]
            details["detected_objects"] = objects
        
        return details
    except Exception as e:
        print(f"[DEBUG] Error getting additional details: {e}")
        return {}


def _enrich_with_wikipedia(label: str) -> Optional[Dict]:
    """Try to find a matching Wikipedia page and Wikidata scientific name.

    Returns a dict with keys: `page_title`, `summary`, `wikidata_id`, `scientific_name`, `wikipedia_url`.
    """
    try:
        print(f"[INFO] Enriching label via Wikipedia: {label}")
        session = requests.Session()
        session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json, text/javascript, */*; q=0.01'
        })

        params = {
            'action': 'query',
            'list': 'search',
            'srsearch': label,
            'srlimit': 3,
            'format': 'json'
        }
        r = session.get('https://en.wikipedia.org/w/api.php', params=params, timeout=10)
        if r.status_code != 200:
            print(f"[DEBUG] Wikipedia search failed: {r.status_code}")
            return None
        data = r.json()
        search = data.get('query', {}).get('search', [])
        if not search:
            return None

        page_title = search[0]['title']

        params2 = {
            'action': 'query',
            'prop': 'extracts|pageprops',
            'exintro': True,
            'explaintext': True,
            'titles': page_title,
            'format': 'json'
        }
        r2 = session.get('https://en.wikipedia.org/w/api.php', params=params2, timeout=10)
        if r2.status_code != 200:
            return None
        d2 = r2.json()
        pages = d2.get('query', {}).get('pages', {})
        if not pages:
            return None
        page = next(iter(pages.values()))
        extract = page.get('extract', '')
        pageprops = page.get('pageprops', {})
        wikibase_id = pageprops.get('wikibase_item')

        scientific_name = None
        if wikibase_id:
            wikidata = _get_wikidata_entity(wikibase_id)
            if wikidata:
                scientific_name = wikidata.get('P225') or wikidata.get('P225_label')

        wiki_url = f"https://en.wikipedia.org/wiki/{page_title.replace(' ', '_')}"

        return {
            'page_title': page_title,
            'summary': extract[:800],
            'wikidata_id': wikibase_id,
            'scientific_name': scientific_name,
            'wikipedia_url': wiki_url
        }

    except Exception as e:
        print(f"[DEBUG] Wikipedia enrichment error: {e}")
        return None


def _get_wikidata_entity(wikibase_id: str) -> Optional[Dict]:
    """Fetch a Wikidata entity and return simple key->value claims for common properties."""
    try:
        url = f'https://www.wikidata.org/wiki/Special:EntityData/{wikibase_id}.json'
        r = requests.get(url, timeout=10, headers={'User-Agent': 'Mozilla/5.0'})
        if r.status_code != 200:
            return None
        data = r.json()
        entities = data.get('entities', {})
        ent = entities.get(wikibase_id, {})
        claims = ent.get('claims', {})
        result = {}
        if 'P225' in claims:
            vals = claims['P225']
            if vals:
                result['P225'] = vals[0].get('mainsnak', {}).get('datavalue', {}).get('value')
        if 'P171' in claims:
            vals = claims['P171']
            if vals:
                result['P171'] = vals[0].get('mainsnak', {}).get('datavalue', {}).get('value', {}).get('id')
        if 'P105' in claims:
            vals = claims['P105']
            if vals:
                result['P105'] = vals[0].get('mainsnak', {}).get('datavalue', {}).get('value')

        return result
    except Exception as e:
        print(f"[DEBUG] Wikidata fetch error: {e}")
        return None


def _try_plantnet(image_bytes: bytes) -> Optional[Dict]:
    """Try PlantNet identify API for plant-specific identification.

    Requires `PLANTNET_API_KEY` environment variable. If not set, this function
    will return None.
    """
    api_key = os.environ.get('PLANTNET_API_KEY')
    if not api_key:
        print("[DEBUG] PLANTNET_API_KEY not set; skipping PlantNet lookup")
        return None

    try:
        print("[INFO] Querying PlantNet identify API...")
        url = f'https://my-api.plantnet.org/v2/identify/all?api-key={api_key}'
        files = {'images': ('image.jpg', image_bytes, 'image/jpeg')}
        params = {'include-related-images': 'false'}
        resp = requests.post(url, files=files, params=params, timeout=30)
        print(f"[DEBUG] PlantNet status: {resp.status_code}")
        if resp.status_code != 200:
            return None
        data = resp.json()
        results = data.get('results') or []
        if not results:
            return None

        top = results[0]
        # PlantNet schema: top may contain 'species' with 'probability'
        species = top.get('species') or top.get('taxonomy') or {}
        probability = float(top.get('probability') or top.get('score') or 0.0)

        scientific = None
        common = None
        if isinstance(species, dict):
            scientific = species.get('scientificName') or species.get('scientificNameWithoutAuthor') or species.get('scientific_name')
            common = species.get('commonNames') and species.get('commonNames')[0] if species.get('commonNames') else species.get('common_name')

        label = scientific or common or top.get('speciesName') or top.get('suggested_common_name')

        result = {
            'label': label,
            'confidence': probability,
            'source': 'plantnet',
            'error': None,
            'raw': data,
        }
        # Attach details if available
        if scientific:
            result.setdefault('additional_details', {})['scientific_name'] = scientific
        if common:
            result.setdefault('additional_details', {})['common_name'] = common
        return result

    except Exception as e:
        print(f"[DEBUG] PlantNet error: {e}")
        return None


if __name__ == "__main__":
    print("NatureScope Google Cloud Vision Classifier")
    print("Methods: classify_image(bytes), classify_from_url(url)")