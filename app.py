from flask import Flask, render_template, Response, jsonify
import cv2
import threading
import smtplib
import time
from email.mime.text import MIMEText
import datetime
from pymongo import MongoClient, DESCENDING 
import os 
from dotenv import load_dotenv

load_dotenv()

CONFIG = {
    'cascade_path': 'fire_detection_cascade_model.xml',
    'alarm_sound_path': 'Alarm Sound.mp3',

    'sender_email': os.getenv('GMAIL_SENDER_EMAIL'),
    'sender_password': os.getenv('GMAIL_APP_PASSWORD'),
    'recipient_email': os.getenv('GMAIL_RECIPIENT_EMAIL'),
    'smtp_server': 'smtp.gmail.com',
    'smtp_port': 587,

    'fire_detection_scale_factor': 1.2,
    'fire_detection_min_neighbors': 5,
    'consecutive_frames_threshold': 3,
    'camera_flip_code': 1,

    'mongo_uri': os.getenv('MONGO_URI'),
    'mongo_db_name': os.getenv('MONGO_DB_NAME'),
    'mongo_collection_name': os.getenv('MONGO_COLLECTION_NAME')
}

app = Flask(__name__)

try:
    if not CONFIG['mongo_uri'] or not CONFIG['sender_password']:
        print("❌ CRITICAL ERROR: .env file not found or variables are missing.")
        print("Please create a .env file with MONGO_URI, GMAIL_APP_PASSWORD, etc.")
        exit()
        
    client = MongoClient(CONFIG['mongo_uri'])
    db = client[CONFIG['mongo_db_name']]
    detections_collection = db[CONFIG['mongo_collection_name']]
    print("✅ Connected to MongoDB successfully!")
except Exception as e:
    print(f"❌ Could not connect to MongoDB: {e}")
    exit()

fire_cascade = cv2.CascadeClassifier(CONFIG['cascade_path'])
camera = cv2.VideoCapture(0)

def get_initial_alarm_state():
    """Check the last event in the DB to set the initial alarm state."""
    last_event = detections_collection.find_one(sort=[("time_obj", DESCENDING)])
    if last_event and last_event.get("status") == "Active":
        print("🔔 Initial state: Alarm is ON (based on last DB entry)")
        return True
    print("✅ Initial state: Alarm is OFF")
    return False

# --- MODIFIED: Global Variables ---
alarm_triggered = get_initial_alarm_state() # Set state from DB
fire_frame_count = 0

def send_email():
    print("📧 Sending alert email...")
    try:
        msg = MIMEText(
            "Fire detected by surveillance system. Please check immediately!",
            'plain', _charset='utf-8'
        )
        msg['Subject'] = "🔥 FIRE ALERT 🔥"
        msg['From'] = CONFIG['sender_email']
        msg['To'] = CONFIG['recipient_email']

        server = smtplib.SMTP(CONFIG['smtp_server'], CONFIG['smtp_port'])
        server.starttls()
        server.login(CONFIG['sender_email'], CONFIG['sender_password'])
        server.sendmail(CONFIG['sender_email'], CONFIG['recipient_email'], msg.as_string())
        server.quit()
        print("✅ Email sent successfully")
    except Exception as e:
        print(f"❌ Email error: {e}")


def generate_frames():
    global alarm_triggered, fire_frame_count

    while True:
        success, frame = camera.read()
        if not success:
            break

        flip_code = CONFIG.get('camera_flip_code', None)
        if flip_code is not None:
            frame = cv2.flip(frame, flip_code)
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        
        fires = fire_cascade.detectMultiScale(
            gray,
            CONFIG['fire_detection_scale_factor'],
            CONFIG['fire_detection_min_neighbors']
        )

        if len(fires) > 0:
            fire_frame_count += 1
            for (x, y, w, h) in fires:
                cv2.rectangle(frame, (x, y), (x+w, y+h), (0, 0, 255), 2)
                cv2.putText(frame, 'FIRE DETECTED!', (x, y-10),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 255), 2)

            # Fire confirmed
            if fire_frame_count >= CONFIG['consecutive_frames_threshold'] and not alarm_triggered:
                alarm_triggered = True
                print("\n🚨 Fire confirmed!")
                confidence_val = min(100, (fire_frame_count / CONFIG['consecutive_frames_threshold']) * 33 + 67)
                
                now = datetime.datetime.now()
                log_entry = {
                    "time_obj": now, 
                    "time": now.strftime("%Y-%m-%d %H:%M:%S"),
                    "status": "Active",
                    "confidence": int(confidence_val),
                    "gps": "26.4567°N, 88.4567°E"
                }

                try:
                    detections_collection.insert_one(log_entry)
                    print("💾 Detection event saved to database.")
                except Exception as e:
                    print(f"❌ Error saving to MongoDB: {e}")

                # threading.Thread(target=play_alarm, daemon=True).start()
                threading.Thread(target=send_email, daemon=True).start()
        else:
            if alarm_triggered:
                print("\n✅ Fire extinguished/cleared.")
                
                # --- NEW: Create log entry to save in DB ---
                now = datetime.datetime.now()
                log_entry = {
                    "time_obj": now, # Add the raw datetime object for sorting
                    "time": now.strftime("%Y-%m-%d %H:%M:%S"),
                    "status": "Cleared",
                    "confidence": 0,
                    "gps": "N/A"
                }

                try:
                    detections_collection.insert_one(log_entry)
                    print("💾 'Cleared' event saved to database.")
                except Exception as e:
                    print(f"❌ Error saving to MongoDB: {e}")

            fire_frame_count = 0
            alarm_triggered = False

        status_text = f"Fire Frames: {fire_frame_count}/{CONFIG['consecutive_frames_threshold']}"
        color = (0, 255, 0) if fire_frame_count < CONFIG['consecutive_frames_threshold'] else (0, 0, 255)
        cv2.putText(frame, status_text, (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.7, color, 2)

        ret, buffer = cv2.imencode('.jpg', frame)
        frame = buffer.tobytes()

        yield (b'--frame\r\n'
               b'Content-Type: image/jpeg\r\n\r\n' + frame + b'\r\n')


# FLASK ROUTES

@app.route('/')
def dashboard():
    return render_template('dashboard.html')


@app.route('/video_feed')
def video_feed():
    return Response(generate_frames(), mimetype='multipart/x-mixed-replace; boundary=frame')


@app.route('/api/status')
def status():
    try:
        logs_cursor = detections_collection.find().sort("time_obj", DESCENDING)
        
        logs_list = []
        for log in logs_cursor:
            log['_id'] = str(log['_id'])
            log.pop('time_obj', None)
            logs_list.append(log)
            
    except Exception as e:
        print(f"❌ Error fetching logs from MongoDB: {e}")
        logs_list = []

    return jsonify({
        "alarm_active": alarm_triggered,
        "full_log": logs_list
    })

if __name__ == '__main__':
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=True)