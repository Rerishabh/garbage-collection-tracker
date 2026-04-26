import json
import os
from datetime import datetime, timedelta
from flask import Flask, render_template, request, jsonify
import uuid
import threading
import time

app = Flask(__name__)  # IMPORTANT LINE

DATA_FILE = 'schedules.json'

data_lock = threading.Lock()

def load_schedules():
    if not os.path.exists(DATA_FILE):
        return []
    with open(DATA_FILE, 'r') as f:
        data = json.load(f)
    return data.get('schedules', [])

def save_schedules(schedules):
    with open(DATA_FILE, 'w') as f:
        json.dump({'schedules': schedules}, f, indent=2)

def get_today():
    return datetime.now().strftime('%Y-%m-%d')

def get_day_name():
    days = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']
    return days[datetime.now().weekday()]

def get_time_diff_minutes(time_str):
    now = datetime.now()
    current_time = now.strftime('%H:%M')
    try:
        current_datetime = datetime.strptime(current_time, '%H:%M')
        scheduled_datetime = datetime.strptime(time_str, '%H:%M')
        return (scheduled_datetime - current_datetime).total_seconds() / 60
    except:
        return None

# 🔔 Background worker
def notification_worker():
    while True:
        time.sleep(60)

        with data_lock:
            schedules = load_schedules()
            today = get_today()
            today_day = get_day_name()

            for schedule in schedules:
                if today_day not in schedule.get('days', []):
                    continue

                if 'status_log' not in schedule:
                    schedule['status_log'] = {}

                if 'last_notified' not in schedule:
                    schedule['last_notified'] = {'pre': '', 'final': ''}

                time_diff = get_time_diff_minutes(schedule['time'])
                if time_diff is None:
                    continue

                if today in schedule['status_log']:
                    continue

                if -1 <= time_diff <= 10 and schedule['last_notified']['pre'] != today:
                    schedule['last_notified']['pre'] = today

                if -1 <= time_diff <= 1 and schedule['last_notified']['final'] != today:
                    schedule['last_notified']['final'] = today

                if time_diff < -1 and today not in schedule['status_log']:
                    schedule['status_log'][today] = 'Missed'

            save_schedules(schedules)

# Start worker
threading.Thread(target=notification_worker, daemon=True).start()

# ================= ROUTES =================

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/schedules', methods=['GET'])
def get_schedules():
    with data_lock:
        schedules = load_schedules()
    return jsonify(schedules)

@app.route('/api/schedules', methods=['POST'])
def create_schedule():
    data = request.json

    if not data.get('area') or not data.get('address') or not data.get('time') or not data.get('days'):
        return jsonify({'error': 'Missing fields'}), 400

    new_schedule = {
        'id': str(uuid.uuid4()),
        'area': data['area'],
        'address': data['address'],
        'time': data['time'],
        'days': data['days'],
        'status_log': {},
        'last_notified': {'pre': '', 'final': ''}
    }

    with data_lock:
        schedules = load_schedules()
        schedules.append(new_schedule)
        save_schedules(schedules)

    return jsonify(new_schedule), 201

@app.route('/api/today-pickups', methods=['GET'])
def get_today_pickups():
    with data_lock:
        schedules = load_schedules()

    today = get_today()
    today_day = get_day_name()

    result = []
    for s in schedules:
        if today_day not in s.get('days', []):
            continue

        status = s.get('status_log', {}).get(today, 'Pending')

        result.append({
            'id': s['id'],
            'area': s['area'],
            'time': s['time'],
            'status': status
        })

    result.sort(key=lambda x: x['time'])
    return jsonify(result)

@app.route('/api/schedules/<schedule_id>', methods=['DELETE'])
def delete_schedule(schedule_id):
    with data_lock:
        schedules = load_schedules()
        schedules = [s for s in schedules if s['id'] != schedule_id]
        save_schedules(schedules)
    return jsonify({'success': True}), 200

@app.route('/api/schedules/<schedule_id>/status', methods=['POST'])
def update_status(schedule_id):
    data = request.json
    new_status = data.get('status')
    if not new_status:
        return jsonify({'error': 'Missing status'}), 400
    
    with data_lock:
        schedules = load_schedules()
        today = get_today()
        for s in schedules:
            if s['id'] == schedule_id:
                if 'status_log' not in s:
                    s['status_log'] = {}
                s['status_log'][today] = new_status
                save_schedules(schedules)
                return jsonify({'success': True}), 200
                
    return jsonify({'error': 'Schedule not found'}), 404

@app.route('/api/stats', methods=['GET'])
def get_stats():
    with data_lock:
        schedules = load_schedules()

    stats = {
        'collected': 0,
        'missed': 0,
        'weekly': {}  # {date: count}
    }

    # Last 7 days for weekly trend
    today = datetime.now()
    dates = [(today - timedelta(days=i)).strftime('%Y-%m-%d') for i in range(6, -1, -1)]
    for d in dates:
        stats['weekly'][d] = 0

    for s in schedules:
        log = s.get('status_log', {})
        for date, status in log.items():
            if status.lower() == 'collected':
                stats['collected'] += 1
                if date in stats['weekly']:
                    stats['weekly'][date] += 1
            elif status.lower() == 'missed':
                stats['missed'] += 1

    return jsonify(stats)

# ================= RUN =================

if __name__ == '__main__':
    app.run(debug=True)
