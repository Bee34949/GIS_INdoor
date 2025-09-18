import json
import firebase_admin
from firebase_admin import credentials, firestore

# init firebase
cred = credentials.Certificate("indoor6mju-firebase-adminsdk-fbsvc-1aeddb1fd2.json")
firebase_admin.initialize_app(cred)
db = firestore.client()

# โหลด nodes และ edges
with open("nodes.json", "r", encoding="utf-8") as f:
    nodes = json.load(f)

with open("edges.json", "r", encoding="utf-8") as f:
    edges = json.load(f)

# อัพโหลด nodes
for node_id, node in nodes.items():
    db.collection("nodes").document(node_id).set({
        "name": node_id,
        "type": node.get("type", "unknown"),
        "floor": node.get("floor", -1),
        "x": node.get("x"),
        "y": node.get("y")
    })

# อัพโหลด edges
for edge in edges:
    db.collection("edges").add({
        "from": edge["from"],
        "to": edge["to"],
        "distance": edge.get("distance", 1.0)
    })

print("✅ Uploaded nodes & edges to Firebase Firestore")
