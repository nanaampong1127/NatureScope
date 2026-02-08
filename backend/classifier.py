"""Google Cloud Vision Species Classifier

A simple classifier that identifies species in images using Google Cloud Vision API.
"""

import requests
from typing import Dict, Optional
import os


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
    
    Args:
        image_bytes: Raw image data as bytes
        
    Returns:
        dict with keys: label, confidence, source, error
    """
    print(f"[INFO] Classifying image ({len(image_bytes)} bytes)")
    
    # Try Google Cloud Vision
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
        "error": "No vision provider could classify the image"
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

        # First try label detection
        response = client.label_detection(image=image, max_results=10)
        if response.error.message:
            print(f"[DEBUG] Google Vision label_detection error: {response.error.message}")
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

                print(f"[INFO] Google Vision top label: {desc} ({score:.2%})")
                return {
                    "label": desc,
                    "confidence": float(score),
                    "source": "google_vision_labels",
                    "error": None
                }

        # Try web detection as a fallback (best guess labels)
        web_resp = client.web_detection(image=image)
        if getattr(web_resp, 'error', None) and getattr(web_resp.error, 'message', None):
            print(f"[DEBUG] Google Vision web_detection error: {web_resp.error.message}")
        else:
            best = getattr(web_resp, 'best_guess_labels', None)
            if best and len(best) > 0:
                bg = best[0]
                label = getattr(bg, 'label', None) or getattr(bg, 'best_guess', None) or None
                if label:
                    print(f"[INFO] Google Vision web best guess: {label}")
                    return {
                        "label": label,
                        "confidence": 0.5,
                        "source": "google_vision_web",
                        "error": None
                    }

    except Exception as e:
        import traceback
        print(f"[DEBUG] Google Vision exception: {type(e).__name__}: {e}")
        traceback.print_exc()

    return None


if __name__ == "__main__":
    print("NatureScope Google Cloud Vision Classifier")
    print("Methods: classify_image(bytes), classify_from_url(url)")