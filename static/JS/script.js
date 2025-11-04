document.addEventListener('DOMContentLoaded', () => {
    // Note: detectionsData is now populated from the API, not generated
    let detectionsData = [];
    let detectionsChart, confidenceChart;
    let isFeedRunning = true;

    // API URL constant
    const STATUS_API_URL = '/api/status'; // The Flask API endpoint

    const NO_SIGNAL_IMG = "https://placehold.co/600x400/374151/f3f4f6?text=NO+SIGNAL";

    const TABS = document.querySelectorAll('.nav-tab');
    const CONTENT_PANES = document.querySelectorAll('.tab-content');

    const DOM_ELEMENTS = {
        activeDetections: document.getElementById('active-detections'),
        lastDetectionTime: document.getElementById('last-detection-time'),
        totalDetectionsDash: document.getElementById('total-detections-dash'),
        recentAlertsContainer: document.getElementById('recent-alerts-container'),
        avgAccuracy: document.getElementById('avg-accuracy'),
        alertsSent: document.getElementById('alerts-sent'),
        allDetectionsTable: document.getElementById('all-detections-table'),

        videoFeed: document.getElementById('videoFeed'),
        toggleFeedButton: document.getElementById('toggleFeedButton'),
        noSignalText: document.getElementById('noSignalText'),
    };

    // --- Video Feed Toggle Logic ---
    const startFeed = () => {
        DOM_ELEMENTS.videoFeed.src = VIDEO_FEED_URL; // Set the live feed URL
        DOM_ELEMENTS.toggleFeedButton.textContent = 'Stop Feed';
        DOM_ELEMENTS.toggleFeedButton.classList.remove('bg-green-600', 'hover:bg-green-700');
        DOM_ELEMENTS.toggleFeedButton.classList.add('bg-red-600', 'hover:bg-red-700');
        DOM_ELEMENTS.noSignalText.classList.add('hidden');
        DOM_ELEMENTS.videoFeed.classList.remove('opacity-0');
        DOM_ELEMENTS.videoFeed.classList.add('opacity-100');
        isFeedRunning = true;
        console.log("Video Feed Started.");
    };

    const stopFeed = () => {
        DOM_ELEMENTS.videoFeed.src = NO_SIGNAL_IMG; // Stops loading the live feed
        DOM_ELEMENTS.toggleFeedButton.textContent = 'Start Feed';
        DOM_ELEMENTS.toggleFeedButton.classList.remove('bg-red-600', 'hover:bg-red-700');
        DOM_ELEMENTS.toggleFeedButton.classList.add('bg-green-600', 'hover:bg-green-700');
        DOM_ELEMENTS.noSignalText.classList.remove('hidden');
        DOM_ELEMENTS.videoFeed.classList.remove('opacity-100');
        DOM_ELEMENTS.videoFeed.classList.add('opacity-0');
        isFeedRunning = false;
        console.log("Video Feed Stopped.");
    };

    const toggleFeed = () => {
        if (isFeedRunning) {
            stopFeed();
        } else {
            startFeed();
        }
    };

    DOM_ELEMENTS.toggleFeedButton.addEventListener('click', toggleFeed);


    // --- Core Data Fetch and Update Logic ---

    // New function to fetch data from Flask API
    const fetchStatus = async () => {
        try {
            const response = await fetch(STATUS_API_URL);
            const data = await response.json();

            // Filter the log to only include true detection *events* (status is "Active")
            detectionsData = data.full_log.filter(d => d.status === "Active");

            updateDashboard(data.alarm_active);

            // Only update analytics if the tab is visible to save resources
            const analyticsTabVisible = document.getElementById('analytics-content').classList.contains('hidden') === false;
            if (analyticsTabVisible) {
                updateAnalytics();
            }

        } catch (error) {
            console.error("Error fetching status data:", error);
        }
    };


    const updateDashboard = (isAlarmActive) => {
        // Only count 'Active' detections from the log for total/recent stats
        const activeDetectionsCount = isAlarmActive ? 1 : 0; // Use the direct API status for real-time active state

        DOM_ELEMENTS.activeDetections.textContent = activeDetectionsCount;
        DOM_ELEMENTS.totalDetectionsDash.textContent = detectionsData.length;

        if (detectionsData.length > 0) {
            // Last detection time from the last logged event
            const lastDetection = detectionsData[detectionsData.length - 1];
            const [datePart, timePart] = lastDetection.time.split(' ');
            DOM_ELEMENTS.lastDetectionTime.textContent = timePart;

            DOM_ELEMENTS.recentAlertsContainer.innerHTML = '';
            // Display last 5 confirmed detections
            const recentDetections = detectionsData.slice(-5).reverse();
            recentDetections.forEach(det => {
                const alertEl = document.createElement('div');
                // Use a standard status since only 'Active' (confirmed) events are in detectionsData now
                alertEl.className = `p-3 rounded-lg border bg-orange-50 border-orange-200`;
                alertEl.innerHTML = `
                            <p class="font-semibold text-sm text-orange-800">
                                FIRE ALERT - ${det.confidence}% Confidence
                            </p>
                            <p class="text-xs text-gray-600">${timePart} at ${det.gps}</p>
                        `;
                DOM_ELEMENTS.recentAlertsContainer.appendChild(alertEl);
            });
        } else {
            DOM_ELEMENTS.lastDetectionTime.textContent = 'N/A';
            DOM_ELEMENTS.recentAlertsContainer.innerHTML = '<p class="text-gray-500">No detections yet.</p>';
        }
    };

    const updateAnalytics = () => {
        if (detectionsData.length === 0) {
            DOM_ELEMENTS.avgAccuracy.textContent = '0%';
            DOM_ELEMENTS.alertsSent.textContent = '0';
            DOM_ELEMENTS.allDetectionsTable.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-gray-500">No data available.</td></tr>';
            updateCharts();
            return;
        }

        const totalConfidence = detectionsData.reduce((sum, d) => sum + d.confidence, 0);
        DOM_ELEMENTS.avgAccuracy.textContent = `${(totalConfidence / detectionsData.length).toFixed(1)}%`;
        DOM_ELEMENTS.alertsSent.textContent = detectionsData.length; // Alerts are equal to confirmed detections

        // Update table
        DOM_ELEMENTS.allDetectionsTable.innerHTML = '';
        // Display latest data first
        detectionsData.slice().reverse().forEach(det => {
            const [datePart, timePart] = det.time.split(' ');
            const row = document.createElement('tr');
            row.className = 'border-b border-gray-100 text-sm';
            row.innerHTML = `
                        <td class="py-2 px-4">${datePart}</td>
                        <td class="py-2 px-4">${timePart}</td>
                        <td class="py-2 px-4 font-semibold text-orange-600">${det.confidence}%</td>
                        <td class="py-2 px-4">${det.gps}</td>
                        <td class="py-2 px-4"><span class="px-2 py-1 text-xs font-semibold rounded-full bg-orange-100 text-orange-800">${det.status}</span></td>
                    `;
            DOM_ELEMENTS.allDetectionsTable.appendChild(row);
        });

        updateCharts();
    };

    const initializeCharts = () => {
        const detectionsCtx = document.getElementById('detectionsChart').getContext('2d');

        detectionsChart = new Chart(detectionsCtx, {
            type: 'line',
            data: { labels: [], datasets: [{ label: 'Detections', data: [], backgroundColor: 'rgba(22, 163, 74, 0.1)', borderColor: '#16a34a', borderWidth: 2, tension: 0.3, fill: true }] },
            options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, suggestedMax: 10 } } }

        });

        const confidenceCtx = document.getElementById('confidenceChart').getContext('2d');
        confidenceChart = new Chart(confidenceCtx, {
            type: 'doughnut',
            data: {

                labels: ['High (>=85%)', 'Warning (60-84%)'],
                datasets: [{ data: [0, 0], backgroundColor: ['#f97316', '#f59e0b'], borderWidth: 0 }]
            },
            options: { responsive: true, maintainAspectRatio: false, cutout: '60%', plugins: { legend: { position: 'bottom' } } }
        });

    };
    const updateCharts = () => {
        // Logic for updateCharts:
        const detectionsByDay = detectionsData.reduce((acc, det) => {
            const datePart = det.time.split(' ')[0]; // Extract date only
            acc[datePart] = (acc[datePart] || 0) + 1;
            return acc;
        }, {});
        detectionsChart.data.labels = Object.keys(detectionsByDay);
        detectionsChart.data.datasets[0].data = Object.values(detectionsByDay);
        detectionsChart.update();

        const highConfidence = detectionsData.filter(d => d.confidence >= 85).length;
        const mediumConfidence = detectionsData.filter(d => d.confidence < 85).length;
        confidenceChart.data.datasets[0].data = [highConfidence, mediumConfidence];
        confidenceChart.update();
    };


    // Tab switching logic (NO CHANGE, but ensures updateAnalytics runs when switching)
    TABS.forEach(tab => {
        tab.addEventListener('click', () => {
            TABS.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            const target = tab.getAttribute('data-tab');
            CONTENT_PANES.forEach(pane => {
                if (pane.id === `${target}-content`) {
                    pane.classList.remove('hidden');
                } else {
                    pane.classList.add('hidden');
                }
            });
            // Run fetchStatus on tab switch to get latest data
            if (target === 'analytics') {
                fetchStatus();
            }
        });
    });

    // Main initialization function
    const init = () => {
        initializeCharts();

        // Start polling the server for real-time status updates every 2 seconds
        setInterval(fetchStatus, 2000);

        // Initial check
        fetchStatus();

        if (isFeedRunning) {
            startFeed();
        } else {
            stopFeed();
        }
    };

    init();
});
