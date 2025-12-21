from flask import Flask, render_template, request, jsonify

app = Flask(__name__)

@app.get("/")
def home():
    return render_template("index.html")

# דוגמה ל-API עתידי: מקבל זווית/עוצמה ומחזיר "מצב"
# כרגע מחזיר משהו דמה כדי לבדוק חיבור בין JS ↔ Python
@app.post("/api/strike")
def strike():
    data = request.get_json(silent=True) or {}
    angle = float(data.get("angle", 0))
    power = float(data.get("power", 0))

    # TODO: כאן נכניס בעתיד סימולציה / seed / מצב כדורים
    return jsonify({
        "ok": True,
        "received": {"angle": angle, "power": power},
        "message": "Server received strike params"
    })

import os

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=True)

