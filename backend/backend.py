from flask import Flask, request, jsonify
from flask_cors import CORS
import classifier
import io
import traceback

app = Flask(__name__)
CORS(app)


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"})


@app.route("/predict", methods=["POST"])
def predict():
    """Classify an image species from uploaded file."""
    if "image" not in request.files:
        return jsonify({"error": "no image file provided"}), 400

    file = request.files["image"]
    if not file or file.filename == "":
        return jsonify({"error": "invalid image file"}), 400

    image_bytes = file.read()
    
    if not image_bytes:
        return jsonify({"error": "image file is empty"}), 400

    try:
        result = classifier.classify_image(image_bytes)
        return jsonify({
            "success": True,
            "result": result
        })
    except Exception as e:
        traceback.print_exc()
        return jsonify({
            "success": False,
            "error": "classification failed",
            "detail": str(e)
        }), 500


@app.route("/predict-url", methods=["POST"])
def predict_url():
    """Classify an image species from URL."""
    data = request.get_json()
    if not data or "url" not in data:
        return jsonify({"error": "no image URL provided"}), 400
    
    url = data["url"]
    
    try:
        result = classifier.classify_from_url(url)
        return jsonify({
            "success": True,
            "result": result
        })
    except Exception as e:
        traceback.print_exc()
        return jsonify({
            "success": False,
            "error": "classification failed",
            "detail": str(e)
        }), 500


if __name__ == "__main__":
    # Run dev server
    app.run(host="0.0.0.0", port=5000, debug=True)
