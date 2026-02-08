from flask import Flask, request, jsonify
from flask_cors import CORS
import classifier
import io

app = Flask(__name__)
CORS(app)


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"})


@app.route("/predict", methods=["POST"])
def predict():
    # Expecting a multipart/form-data request with file field named 'image'
    if "image" not in request.files:
        return jsonify({"error": "no image file provided"}), 400

    file = request.files["image"]
    image_bytes = file.read()

    try:
        result = classifier.classify_image(image_bytes)
    except Exception as e:
        return jsonify({"error": "classification failed", "detail": str(e)}), 500

    return jsonify({"result": result})


if __name__ == "__main__":
    # Run dev server
    app.run(host="0.0.0.0", port=5000, debug=True)
