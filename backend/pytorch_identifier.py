"""Lightweight PyTorch plant-vs-animal identifier

Returns JSON with decision, confidence and top predictions.

This uses a pretrained ResNet50 from torchvision and simple keyword heuristics
on ImageNet class names to decide whether an image is a plant or an animal.
"""

import io
import json
from typing import List, Dict

try:
    import requests
    from PIL import Image
    import torch
    from torchvision import transforms, models
except Exception as e:
    raise ImportError(f"Missing dependency: {e}. Install with `pip install torch torchvision pillow requests`")


_IMAGE_NET_CLASSES_URL = "https://raw.githubusercontent.com/pytorch/hub/master/imagenet_classes.txt"


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


def _load_model():
    # Load ResNet50 pretrained
    try:
        model = models.resnet50(pretrained=True)
    except TypeError:
        # older/newer torchvision API
        model = models.resnet50(weights=models.ResNet50_Weights.DEFAULT)
    model.eval()
    return model


def _prepare_image(image: Image.Image):
    preprocess = transforms.Compose([
        transforms.Resize(256),
        transforms.CenterCrop(224),
        transforms.ToTensor(),
        transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
    ])
    return preprocess(image).unsqueeze(0)


def _download_image(url: str) -> Image.Image:
    r = requests.get(url, timeout=15, headers={"User-Agent": "NatureScope/1.0"})
    r.raise_for_status()
    return Image.open(io.BytesIO(r.content)).convert('RGB')


def classify_image_source(image_bytes: bytes, model=None, labels=None) -> Dict:
    """Classify image bytes and decide plant vs animal."""
    # Load resources lazily
    if labels is None:
        labels = _load_imagenet_labels()
    if model is None:
        model = _load_model()

    # Load image from bytes
    img = Image.open(io.BytesIO(image_bytes)).convert('RGB')
    inp = _prepare_image(img)

    with torch.no_grad():
        out = model(inp)
        probs = torch.nn.functional.softmax(out[0], dim=0)

    topk = 5
    top_prob, top_idx = probs.topk(topk)
    top_predictions = []
    for p, idx in zip(top_prob.tolist(), top_idx.tolist()):
        label = labels[idx] if idx < len(labels) else str(idx)
        top_predictions.append({"label": label, "probability": float(p)})

    # Heuristic decision based on labels
    plant_keywords = ['plant', 'flower', 'tree', 'leaf', 'mushroom', 'fungus', 'orchid', 'rose', 'daisy', 'tulip', 'vegetable', 'fruit', 'cabbage', 'cucumber', 'banana', 'corn', 'grass', 'herb', 'moss', 'fern', 'cactus', 'succulent']
    animal_keywords = ['dog', 'cat', 'bird', 'fish', 'mammal', 'insect', 'butterfly', 'beetle', 'spider', 'horse', 'cow', 'sheep', 'pig', 'lion', 'tiger', 'bear', 'frog', 'toad', 'snake', 'lizard', 'monkey', 'ape', 'whale', 'shark', 'ant', 'bee', 'dragonfly', 'cricket', 'grasshopper', 'moth', 'wasp', 'fly', 'mosquito', 'termite', 'worm', 'snail', 'crab', 'lobster', 'turtle', 'eagle', 'owl']

    # Count hits in top predictions
    plant_score = 0.0
    animal_score = 0.0
    for pred in top_predictions:
        txt = pred['label'].lower()
        prob = pred['probability']
        if any(k in txt for k in plant_keywords):
            plant_score += prob
        if any(k in txt for k in animal_keywords):
            animal_score += prob

    # Always decide between plant or animal (pick the higher score)
    decision = 'plant' if plant_score >= animal_score else 'animal'
    confidence = max(plant_score, animal_score)

    return {
        'decision': decision,
        'confidence': float(confidence),
        'top_predictions': top_predictions
    }
