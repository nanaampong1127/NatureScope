"""Ensemble plant-vs-animal identifier using multiple pretrained models

Uses ResNet50, EfficientNet-B2, and Vision Transformer (ViT-B16) for robust
classification. Ensembles their predictions for higher accuracy.

Returns JSON with decision, confidence and top predictions.
"""

import io
from typing import List, Dict, Tuple, Optional

try:
    import requests
    from PIL import Image
    import torch
    from torchvision import transforms, models
except Exception as e:
    raise ImportError(f"Missing dependency: {e}. Install with `pip install torch torchvision pillow requests`")


_IMAGE_NET_CLASSES_URL = "https://raw.githubusercontent.com/pytorch/hub/master/imagenet_classes.txt"

# Cached models and transforms
_MODELS = {}  # {model_name: model}
_LABELS: Optional[List[str]] = None
_TRANSFORMS = {}  # {model_name: transform}

# High-confidence plant keywords (weighted higher in scoring)
_PLANT_KEYWORDS_PRIMARY = {
    'plant', 'flower', 'tree', 'leaf', 'leaves', 'blossom', 'petal',
    'vegetable', 'fruit', 'shrub', 'bush', 'herb', 'succulent', 'cactus',
    'fern', 'moss', 'seaweed', 'grass', 'grain', 'cereal', 'legume'
}

# Supporting plant keywords
_PLANT_KEYWORDS_SECONDARY = {
    'orchid', 'rose', 'daisy', 'tulip', 'sunflower', 'lily', 'iris', 'lotus',
    'cabbage', 'carrot', 'potato', 'tomato', 'lettuce', 'spinach', 'broccoli',
    'banana', 'apple', 'orange', 'grape', 'strawberry', 'blueberry', 'raspberry',
    'corn', 'wheat', 'rice', 'barley', 'oats', 'pine', 'oak', 'maple', 'birch',
    'palm', 'bamboo', 'willow', 'pine', 'spruce', 'elm', 'ash', 'beech',
    'ivy', 'vine', 'climbing', 'weed', 'lichen', 'fungus', 'mushroom', 'toadstool'
}

_PLANT_KEYWORDS = _PLANT_KEYWORDS_PRIMARY | _PLANT_KEYWORDS_SECONDARY

# High-confidence animal keywords (weighted higher in scoring)
_ANIMAL_KEYWORDS_PRIMARY = {
    'dog', 'cat', 'bird', 'fish', 'mammal', 'insect', 'animal',
    'horse', 'cow', 'sheep', 'pig', 'monkey', 'bear', 'lion', 'tiger',
    'snake', 'lizard', 'frog', 'turtle', 'beetle', 'butterfly', 'ant', 'bee'
}

# Supporting animal keywords
_ANIMAL_KEYWORDS_SECONDARY = {
    'puppy', 'kitten', 'spider', 'squirrel', 'rabbit', 'deer', 'wolf', 'fox',
    'whale', 'dolphin', 'shark', 'eagle', 'owl', 'duck', 'goose', 'penguin',
    'zebra', 'giraffe', 'elephant', 'rhinoceros', 'hippopotamus', 'otter', 'seal',
    'dragonfly', 'cricket', 'grasshopper', 'moth', 'wasp', 'fly', 'mosquito',
    'termite', 'snail', 'crab', 'lobster', 'shrimp', 'scorpion', 'worm'
}

_ANIMAL_KEYWORDS = _ANIMAL_KEYWORDS_PRIMARY | _ANIMAL_KEYWORDS_SECONDARY


def _load_imagenet_labels() -> List[str]:
    try:
        r = requests.get(_IMAGE_NET_CLASSES_URL, timeout=10)
        r.raise_for_status()
        labels = [l.strip() for l in r.text.splitlines() if l.strip()]
        if len(labels) == 1000:
            return labels
    except Exception:
        pass
    # Fallback: generate numeric labels
    return [str(i) for i in range(1000)]


def _get_model_bundle() -> Tuple[Dict, List[str], Dict]:
    """Return cached (models_dict, labels, transforms_dict) for all ensemble models."""
    global _MODELS, _LABELS, _TRANSFORMS

    if _MODELS and _LABELS and _TRANSFORMS:
        return _MODELS, _LABELS, _TRANSFORMS

    labels = _load_imagenet_labels()
    _LABELS = labels

    # Load ResNet50
    try:
        weights_resnet = models.ResNet50_Weights.DEFAULT
        model_resnet = models.resnet50(weights=weights_resnet)
        model_resnet.eval()
        _MODELS['resnet50'] = model_resnet
        _TRANSFORMS['resnet50'] = weights_resnet.transforms()
    except Exception as e:
        print(f"[WARNING] Failed to load ResNet50: {e}")

    # Load EfficientNet-B2
    try:
        weights_effnet = models.EfficientNet_B2_Weights.DEFAULT
        model_effnet = models.efficientnet_b2(weights=weights_effnet)
        model_effnet.eval()
        _MODELS['efficientnet_b2'] = model_effnet
        _TRANSFORMS['efficientnet_b2'] = weights_effnet.transforms()
    except Exception as e:
        print(f"[WARNING] Failed to load EfficientNet-B2: {e}")

    # Load Vision Transformer B-16
    try:
        weights_vit = models.ViT_B_16_Weights.DEFAULT
        model_vit = models.vit_b_16(weights=weights_vit)
        model_vit.eval()
        _MODELS['vit_b_16'] = model_vit
        _TRANSFORMS['vit_b_16'] = weights_vit.transforms()
    except Exception as e:
        print(f"[WARNING] Failed to load ViT-B16: {e}")

    if not _MODELS:
        raise RuntimeError("Failed to load any ensemble models")

    return _MODELS, _LABELS, _TRANSFORMS


def _prepare_image(image: Image.Image, transform) -> object:
    return transform(image).unsqueeze(0)


def classify_image_source(image_bytes: bytes, model=None, labels=None) -> Dict:
    """Classify image bytes using ensemble of models (ResNet50, EfficientNet-B2, ViT-B16)."""
    # Load resources lazily (with caching)
    if not model or not labels:
        models_dict, labels, transforms_dict = _get_model_bundle()
    else:
        transforms_dict = _TRANSFORMS

    # Load image from bytes
    img = Image.open(io.BytesIO(image_bytes)).convert('RGB')

    # Run inference on all ensemble models
    ensemble_scores = {
        'plant_scores': [],
        'animal_scores': [],
        'all_predictions': []
    }

    for model_name, model in models_dict.items():
        transform = transforms_dict.get(model_name)
        if not transform:
            continue

        try:
            inp = _prepare_image(img, transform)

            with torch.inference_mode():
                out = model(inp)
                probs = torch.nn.functional.softmax(out[0], dim=0)

            topk = 5
            top_prob, top_idx = probs.topk(topk)

            # Get predictions for this model
            model_predictions = []
            plant_score = 0.0
            animal_score = 0.0

            for rank, (p, idx) in enumerate(zip(top_prob.tolist(), top_idx.tolist())):
                label = labels[idx] if idx < len(labels) else "unknown"
                prob = float(p)
                model_predictions.append({"label": label, "probability": prob})

                # Calculate plant/animal scores
                txt = label.lower()
                rank_weight = 1.0 - (rank * 0.2)

                plant_primary = any(k in txt for k in _PLANT_KEYWORDS_PRIMARY)
                animal_primary = any(k in txt for k in _ANIMAL_KEYWORDS_PRIMARY)
                plant_secondary = any(k in txt for k in _PLANT_KEYWORDS_SECONDARY)
                animal_secondary = any(k in txt for k in _ANIMAL_KEYWORDS_SECONDARY)

                if plant_primary:
                    plant_score += prob * rank_weight * 1.5
                elif plant_secondary:
                    plant_score += prob * rank_weight * 1.0

                if animal_primary:
                    animal_score += prob * rank_weight * 1.5
                elif animal_secondary:
                    animal_score += prob * rank_weight * 1.0

            ensemble_scores['plant_scores'].append(plant_score)
            ensemble_scores['animal_scores'].append(animal_score)
            ensemble_scores['all_predictions'].append(model_predictions)

        except Exception as e:
            print(f"[WARNING] Error in {model_name}: {e}")
            continue

    # Aggregate ensemble predictions
    if not ensemble_scores['plant_scores']:
        raise RuntimeError("No models produced valid predictions")

    avg_plant_score = sum(ensemble_scores['plant_scores']) / len(ensemble_scores['plant_scores'])
    avg_animal_score = sum(ensemble_scores['animal_scores']) / len(ensemble_scores['animal_scores'])

    # Normalize scores
    total_score = avg_plant_score + avg_animal_score
    if total_score > 0:
        plant_score_norm = avg_plant_score / total_score
        animal_score_norm = avg_animal_score / total_score
    else:
        plant_score_norm = 0.5
        animal_score_norm = 0.5

    # Final decision from ensemble
    decision = 'plant' if plant_score_norm >= 0.5 else 'animal'
    confidence = max(plant_score_norm, animal_score_norm)

    # Also return the top-1 prediction across ensemble (most common from first model)
    top_predictions = ensemble_scores['all_predictions'][0] if ensemble_scores['all_predictions'] else []

    return {
        'decision': decision,
        'confidence': float(confidence),
        'top_predictions': top_predictions,
        'ensemble_models': list(models_dict.keys()),
        'ensemble_accuracy': {
            'plant_score': float(avg_plant_score),
            'animal_score': float(avg_animal_score),
            'num_models': len(ensemble_scores['plant_scores'])
        }
    }
