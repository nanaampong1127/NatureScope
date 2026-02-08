"""Simple classifier interface for the project.

This module exposes `classify_image(image_bytes)` so the Flask
backend can call it. Currently it's a placeholder that returns a
mocked classification result. Replace `classify_image` implementation
with a real model (or wrap an existing one) when available.
"""

from typing import Dict, Optional, Any
import requests
import json


INAT_IDENTIFY_URL = "https://api.inaturalist.org/v1/observations/identify"


def _extract_species_from_response(data: Any) -> Optional[Dict]:
	"""Attempt to find a species suggestion in the iNaturalist response.

	Returns a dict like {"name": ..., "common_name": ..., "score": ...}
	or None if nothing recognizable is found.
	"""

	if isinstance(data, dict):
		# Common places where taxon info appears
		if "taxon" in data and isinstance(data["taxon"], dict):
			tax = data["taxon"]
			name = tax.get("name") or tax.get("scientific_name") or tax.get("preferred_common_name")
			common = tax.get("preferred_common_name")
			score = data.get("score") or data.get("confidence")
			if name:
				return {"name": name, "common_name": common, "score": score}

		# direct fields
		if "species_guess" in data:
			return {"name": data.get("species_guess"), "common_name": None, "score": data.get("score")}

		# recurse
		for v in data.values():
			found = _extract_species_from_response(v)
			if found:
				return found

	elif isinstance(data, list):
		for item in data:
			found = _extract_species_from_response(item)
			if found:
				return found

	return None


def classify_image(image_bytes: bytes) -> Dict:
	"""Use iNaturalist's identify API to suggest a species for the uploaded image.

	This function tries several common multipart field names used by the iNaturalist
	API/UI and returns the top suggestion if available. Because public API specifics
	can change, the function is defensive and returns the raw server response under
	the `raw` key for debugging.

	Returns: {"label": <scientific name or common>, "confidence": float|null, "raw": <server json>}
	"""

	field_names = ["image", "file", "images[]", "observation_photos[][file]", "photo"]

	headers = {"User-Agent": "MJL-hackathon/1.0 (contact: none)"}

	for field in field_names:
		files = {field: ("image.jpg", image_bytes, "image/jpeg")}
		try:
			resp = requests.post(INAT_IDENTIFY_URL, files=files, headers=headers, timeout=15)
		except requests.RequestException:
			continue

		if resp.status_code != 200:
			continue

		try:
			j = resp.json()
		except ValueError:
			continue

		species_info = _extract_species_from_response(j)
		if species_info:
			label = species_info.get("name") or species_info.get("common_name")
			confidence = species_info.get("score")
			return {"label": label, "confidence": confidence, "raw": j}

		# fallback: if server returns suggestions list or results, include raw
		if isinstance(j, dict) and any(k in j for k in ("results", "suggestions", "predictions")):
			return {"label": None, "confidence": None, "raw": j}

	# If none of the attempts worked, return an error-like structure
	return {"label": None, "confidence": None, "raw": {"error": "no suggestion or request failed"}}


if __name__ == "__main__":
	print("classifier module ready — calls iNaturalist identify API")