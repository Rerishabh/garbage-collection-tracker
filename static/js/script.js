// Load settings from localStorage
let soundEnabled = localStorage.getItem('soundEnabled') !== 'false';
let notificationsEnabled = localStorage.getItem('notificationsEnabled') !== 'false';

// Audio Context for fallback sounds
let audioContext;
function initAudio() {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioContext.state === 'suspended') {
        audioContext.resume();
    }
}

// Initialize audio on first interaction
document.addEventListener('click', initAudio, { once: true });
document.addEventListener('touchstart', initAudio, { once: true });

// Notification tracking
const notifiedPickups = {};
const alertTypes = {
    WARNING: 'warning',      // 10 minutes before
    URGENT: 'urgent',        // Time reached
    MISSED: 'missed'         // Pickup time passed
};

// Section switching function
function switchSection(sectionId, event) {
    // Hide all sections
    const sections = document.querySelectorAll('.section-content');
    sections.forEach(section => section.classList.remove('active'));
    
    // Remove active class from all nav buttons
    const navBtns = document.querySelectorAll('.list-group-item');
    navBtns.forEach(btn => btn.classList.remove('active'));
    
    // Show selected section
    const section = document.getElementById(sectionId);
    if (section) {
        section.classList.add('active');
    }
    
    // Add active class to clicked button
    if (event && event.currentTarget) {
        event.currentTarget.classList.add('active');
    }

    // Load analytics if section is active
    if (sectionId === 'analytics') {
        loadAnalytics();
    }
}

let statusChart = null;
let trendChart = null;

async function loadAnalytics() {
    try {
        const res = await fetch('/api/stats');
        const data = await res.json();

        // Pie Chart: Collected vs Missed
        const statusCtx = document.getElementById('statusChart').getContext('2d');
        if (statusChart) statusChart.destroy();
        statusChart = new Chart(statusCtx, {
            type: 'pie',
            data: {
                labels: ['Collected', 'Missed'],
                datasets: [{
                    data: [data.collected, data.missed],
                    backgroundColor: ['#48bb78', '#f56565'],
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'bottom' }
                }
            }
        });

        // Bar Chart: Weekly Trend
        const trendCtx = document.getElementById('trendChart').getContext('2d');
        if (trendChart) trendChart.destroy();
        
        const dates = Object.keys(data.weekly).sort();
        const counts = dates.map(d => data.weekly[d]);
        const labels = dates.map(d => {
            const date = new Date(d);
            return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
        });

        trendChart = new Chart(trendCtx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Pickups Collected',
                    data: counts,
                    backgroundColor: '#667eea',
                    borderRadius: 5
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: { stepSize: 1 }
                    }
                }
            }
        });
    } catch (error) {
        console.error('Error loading analytics:', error);
    }
}

async function updateStatus(scheduleId, newStatus) {
    try {
        const res = await fetch(`/api/schedules/${scheduleId}/status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: newStatus })
        });

        if (res.ok) {
            loadToday();
            // If analytics section is visible, update it too
            const analyticsSection = document.getElementById('analytics');
            if (analyticsSection && analyticsSection.classList.contains('active')) {
                loadAnalytics();
            }
        }
    } catch (error) {
        console.error('Error updating status:', error);
    }
}

document.addEventListener('DOMContentLoaded', function() {
    document.getElementById('soundToggle').checked = soundEnabled;
    document.getElementById('notificationToggle').checked = notificationsEnabled;

    document.getElementById('soundToggle').addEventListener('change', function() {
        soundEnabled = this.checked;
        localStorage.setItem('soundEnabled', soundEnabled);
    });

    document.getElementById('notificationToggle').addEventListener('change', function() {
        notificationsEnabled = this.checked;
        localStorage.setItem('notificationsEnabled', notificationsEnabled);
        if (notificationsEnabled && 'Notification' in window) {
            Notification.requestPermission();
        }
    });

    // Request notification permission
    if ('Notification' in window && notificationsEnabled) {
        Notification.requestPermission();
    }
    
    // Load initial data
    loadToday();
    loadAllSchedules();
    
    // Start monitoring for upcoming pickups
    startPickupMonitor();
});

function playSound(type = 'default') {
    if (!soundEnabled) return;
    
    // Attempt to resume audio context if it exists
    if (audioContext && audioContext.state === 'suspended') {
        audioContext.resume();
    }
    
    try {
        // Try to play alert.mp3 file
        const audioPath = '/static/sounds/alert.mp3';
        const audio = new Audio(audioPath);
        
        // Adjust volume based on alert type
        if (type === 'urgent') {
            audio.volume = 1.0;
        } else {
            audio.volume = 0.7;
        }
        
        // Play the sound
        const playPromise = audio.play();
        if (playPromise !== undefined) {
            playPromise.catch(error => {
                console.warn('Could not play alert sound file, falling back to beep:', error);
                playOscillatorTone();
            });
        }
    } catch (error) {
        console.warn('Error loading sound file, using fallback beep:', error);
        playOscillatorTone();
    }
}

function playOscillatorTone() {
    try {
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        
        if (audioContext.state === 'suspended') {
            audioContext.resume();
        }
        
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        // Make it a more noticeable double beep for urgent
        oscillator.frequency.value = 880; // A5
        oscillator.type = 'sine';
        
        gainNode.gain.setValueAtTime(0, audioContext.currentTime);
        gainNode.gain.linearRampToValueAtTime(0.2, audioContext.currentTime + 0.1);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.4);
        
        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.5);
    } catch (error) {
        console.warn('Could not create oscillator:', error);
    }
}

function showNotification(title, message, options = {}) {
    if (!notificationsEnabled || !('Notification' in window)) return;
    
    if (Notification.permission === 'granted') {
        const defaultOptions = {
            body: message,
            icon: '🗑️',
            tag: options.tag || 'garbage-alert',
            badge: '🗑️',
            requireInteraction: options.requireInteraction || false,
            data: options.data || {}
        };
        
        const notification = new Notification(title, defaultOptions);
        
        // Handle notification click
        notification.onclick = () => {
            window.focus();
            notification.close();
        };
        
        return notification;
    }
}

function showPickupNotification(area, time, minutesUntil) {
    if (!notificationsEnabled) return;
    
    let title, message, tag;
    
    if (minutesUntil <= 0) {
        // Pickup time has been reached
        title = '🚨 Urgent: Pickup Now!';
        message = `${area} pickup is now!`;
        tag = `pickup-urgent-${area}-${time}`;
        playSound('urgent');
    } else if (minutesUntil <= 10) {
        // Warning: within 10 minutes
        title = '⏰ Upcoming Pickup';
        message = `${area} pickup in ${minutesUntil} minute${minutesUntil !== 1 ? 's' : ''} at ${time}`;
        tag = `pickup-warning-${area}-${time}`;
        playSound('warning');
    } else {
        return; // No notification needed
    }
    
    showNotification(title, message, {
        tag: tag,
        requireInteraction: minutesUntil <= 0,
        data: { area, time, type: minutesUntil <= 0 ? 'urgent' : 'warning' }
    });
}

function getMinutesUntilPickup(pickupTime) {
    const now = new Date();
    const [hours, minutes] = pickupTime.split(':').map(Number);
    const pickupDate = new Date();
    pickupDate.setHours(hours, minutes, 0, 0);
    
    const diffMs = pickupDate - now;
    return Math.floor(diffMs / 60000);
}

function checkUpcomingPickups(pickups) {
    pickups.forEach(pickup => {
        const minutesUntil = getMinutesUntilPickup(pickup.time);
        const notificationKey = `${pickup.area}-${pickup.time}`;
        
        // Only notify if:
        // 1. Within 10 minutes (warning)
        // 2. Time has been reached (urgent)
        // 3. Haven't already notified for this time frame
        if (minutesUntil <= 10 && minutesUntil > 0) {
            if (!notifiedPickups[notificationKey] || notifiedPickups[notificationKey] !== 'warning') {
                showPickupNotification(pickup.area, pickup.time, minutesUntil);
                notifiedPickups[notificationKey] = 'warning';
            }
        } else if (minutesUntil <= 0 && minutesUntil > -5) {
            // Urgent notification within the pickup time
            if (notifiedPickups[notificationKey] !== 'urgent') {
                showPickupNotification(pickup.area, pickup.time, minutesUntil);
                notifiedPickups[notificationKey] = 'urgent';
            }
        }
    });
}

function startPickupMonitor() {
    // Initial check is done by loadToday
    console.log("Pickup monitor initialized");
}

async function addSchedule() {
    const area = document.getElementById("area").value.trim();
    const address = document.getElementById("address").value.trim();
    const time = document.getElementById("time").value;

    if (!area || !address || !time) {
        alert("Please fill all fields");
        return;
    }

    // Get selected days from new checkbox IDs
    const dayCheckboxes = {
        'Monday': document.getElementById('mon').checked,
        'Tuesday': document.getElementById('tue').checked,
        'Wednesday': document.getElementById('wed').checked,
        'Thursday': document.getElementById('thu').checked,
        'Friday': document.getElementById('fri').checked,
        'Saturday': document.getElementById('sat').checked,
        'Sunday': document.getElementById('sun').checked
    };

    const days = Object.keys(dayCheckboxes).filter(day => dayCheckboxes[day]);

    if (days.length === 0) {
        alert("Please select at least one day");
        return;
    }

    const res = await fetch('/api/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ area, address, time, days })
    });

    if (res.ok) {
        document.getElementById("scheduleForm").reset();
        loadToday();
        loadAllSchedules();
        playSound();
        showNotification("Schedule Added", `${area} at ${time} added successfully`);
    } else {
        alert("❌ Error adding schedule");
    }
}

async function deleteSchedule(scheduleId) {
    if (!confirm("Are you sure you want to delete this schedule?")) {
        return;
    }

    const res = await fetch(`/api/schedules/${scheduleId}`, {
        method: 'DELETE'
    });

    if (res.ok) {
        loadToday();
        loadAllSchedules();
    } else {
        alert("Error deleting schedule");
    }
}

function getStatusButtons(status, scheduleId) {
    const statusLower = status.toLowerCase();
    
    return `
        <div class="d-flex gap-2 mt-2">
            <button class="btn btn-sm ${statusLower === 'collected' ? 'btn-success' : 'btn-outline-success'} flex-grow-1" 
                    onclick="updateStatus('${scheduleId}', 'Collected')">
                <i class="bi bi-check-circle"></i> Collected
            </button>
            <button class="btn btn-sm ${statusLower === 'missed' ? 'btn-danger' : 'btn-outline-danger'} flex-grow-1" 
                    onclick="updateStatus('${scheduleId}', 'Missed')">
                <i class="bi bi-x-circle"></i> Missed
            </button>
        </div>
    `;
}

async function loadToday() {
    const res = await fetch('/api/today-pickups');
    const data = await res.json();

    // Check for upcoming pickups to trigger notifications/sounds
    checkUpcomingPickups(data);

    const container = document.getElementById("pickupsContainer");
    const emptyState = document.getElementById("emptyState");
    container.innerHTML = "";

    if (data.length === 0) {
        emptyState.style.display = 'block';
    } else {
        emptyState.style.display = 'none';
        data.forEach(item => {
            const card = document.createElement("div");
            card.className = "col-md-6 col-lg-4";
            
            // Determine status badge for the top right
            const statusLower = item.status.toLowerCase();
            let badgeClass = 'badge-pending';
            if (statusLower === 'collected') badgeClass = 'badge-collected';
            if (statusLower === 'missed') badgeClass = 'badge-missed';

            card.innerHTML = `
                <div class="card pickup-card h-100">
                    <div class="card-body d-flex flex-column">
                        <div class="d-flex justify-content-between align-items-start mb-2">
                            <h6 class="pickup-card-title mb-0">📍 ${item.area}</h6>
                            <span class="badge ${badgeClass}">${item.status}</span>
                        </div>
                        <p class="pickup-card-time mb-3">
                            <i class="bi bi-clock"></i> ${item.time}
                        </p>
                        <div class="mt-auto">
                            ${getStatusButtons(item.status, item.id)}
                        </div>
                    </div>
                </div>
            `;
            container.appendChild(card);
        });
    }
}

async function loadAllSchedules() {
    const res = await fetch('/api/schedules');
    const schedules = await res.json();

    const container = document.getElementById("allSchedulesContainer");
    const emptyState = document.getElementById("emptySchedules");
    container.innerHTML = "";

    if (schedules.length === 0) {
        emptyState.style.display = 'block';
    } else {
        emptyState.style.display = 'none';
        schedules.forEach(schedule => {
            const daysText = schedule.days.join(", ");
            const col = document.createElement("div");
            col.className = "col-md-6 col-lg-4";
            col.innerHTML = `
                <div class="card schedule-card h-100">
                    <div class="card-body d-flex flex-column">
                        <h6 class="schedule-card-title">📍 ${schedule.area}</h6>
                        <p class="schedule-card-subtitle">${schedule.address}</p>
                        <div class="schedule-card-details">
                            <div class="schedule-detail">
                                <i class="bi bi-clock"></i> ${schedule.time}
                            </div>
                            <div class="schedule-detail">
                                <i class="bi bi-calendar"></i> ${daysText}
                            </div>
                        </div>
                        <div class="mt-auto pt-3 d-grid">
                            <button class="btn btn-delete btn-sm" onclick="deleteSchedule('${schedule.id}')">
                                <i class="bi bi-trash"></i> Delete
                            </button>
                        </div>
                    </div>
                </div>
            `;
            container.appendChild(col);
        });
    }
}

// Load data on page load and refresh every minute
loadToday();
loadAllSchedules();
setInterval(() => {
    loadToday();
    loadAllSchedules();
}, 60000);
