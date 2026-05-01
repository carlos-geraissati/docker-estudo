const API_BASE = '';
let currentPage = 0;
const PAGE_SIZE = 20;
let currentSport = '';
let currentEventId = null;
let currentSessionId = null;
let currentSessionName = '';
let currentEventName = '';
let lapChart = null;

// --- Navigation ---

function showView(viewName) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(`${viewName}-view`).classList.add('active');
}

function goBackToSessions() {
    showView('sessions');
}

function goBackToClassification() {
    showView('classification');
}

// --- Sport Filter ---

document.querySelectorAll('.sport-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.sport-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentSport = btn.dataset.sport;
        currentPage = 0;
        loadEvents();
    });
});

// --- Pagination ---

document.getElementById('prev-page').addEventListener('click', () => {
    if (currentPage > 0) {
        currentPage--;
        loadEvents();
    }
});

document.getElementById('next-page').addEventListener('click', () => {
    currentPage++;
    loadEvents();
});

function updatePagination(eventsCount) {
    document.getElementById('prev-page').disabled = currentPage === 0;
    document.getElementById('next-page').disabled = eventsCount < PAGE_SIZE;
    document.getElementById('page-info').textContent = `P\u00e1gina ${currentPage + 1}`;
}

// --- Load Events ---

async function loadEvents() {
    const container = document.getElementById('events-list');
    container.innerHTML = '<div class="loading">Carregando eventos...</div>';
    showView('events');

    const params = new URLSearchParams({ count: PAGE_SIZE, offset: currentPage * PAGE_SIZE });
    if (currentSport) params.append('sport', currentSport);

    try {
        const resp = await fetch(`${API_BASE}/api/events?${params}`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const events = await resp.json();

        if (!events.length) {
            container.innerHTML = '<div class="empty-state"><div class="icon">&#127937;</div><p>Nenhum evento encontrado.</p></div>';
            updatePagination(0);
            return;
        }

        container.innerHTML = events.map(ev => `
            <div class="event-card" data-event-id="${ev.id}">
                <div class="event-name">${escHtml(ev.name)}</div>
                <div class="event-meta">
                    <span class="sport-badge ${sportClass(ev.sport)}">${escHtml(ev.sport)}</span>
                    <span class="event-meta-item"><span class="icon">&#128197;</span> ${formatDate(ev.startDate)}</span>
                    ${ev.location ? `<span class="event-meta-item"><span class="icon">&#128205;</span> ${escHtml(ev.location.name)}</span>` : ''}
                    ${ev.organization ? `<span class="event-meta-item"><span class="icon">&#127970;</span> ${escHtml(ev.organization.name || '')}</span>` : ''}
                    ${ev.location && ev.location.length > 0 ? `<span class="event-meta-item"><span class="icon">&#128207;</span> ${escHtml(ev.location.lengthLabel)}</span>` : ''}
                </div>
            </div>
        `).join('');

        container.querySelectorAll('.event-card').forEach(el => {
            el.addEventListener('click', () => loadEvent(parseInt(el.dataset.eventId)));
        });

        updatePagination(events.length);
    } catch (err) {
        container.innerHTML = `<div class="empty-state"><div class="icon">&#9888;</div><p>Erro ao carregar eventos: ${escHtml(err.message)}</p></div>`;
    }
}

// --- Load Event Detail / Sessions ---

async function loadEvent(eventId) {
    currentEventId = eventId;
    showView('sessions');

    const headerEl = document.getElementById('event-header');
    const listEl = document.getElementById('sessions-list');
    headerEl.innerHTML = '';
    listEl.innerHTML = '<div class="loading">Carregando sess\u00f5es...</div>';

    try {
        const resp = await fetch(`${API_BASE}/api/events/${eventId}?sessions=true`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const ev = await resp.json();
        currentEventName = ev.name;

        headerEl.innerHTML = `
            <h2>${escHtml(ev.name)}</h2>
            <div class="meta-row">
                <span class="sport-badge ${sportClass(ev.sport)}">${escHtml(ev.sport)}</span>
                <span>&#128197; ${formatDate(ev.startDate)}</span>
                ${ev.location ? `<span>&#128205; ${escHtml(ev.location.name)} ${ev.location.country ? '(' + escHtml(ev.location.country.name) + ')' : ''}</span>` : ''}
                ${ev.location && ev.location.length > 0 ? `<span>&#128207; ${escHtml(ev.location.lengthLabel)}</span>` : ''}
                ${ev.organization && ev.organization.name ? `<span>&#127970; ${escHtml(ev.organization.name)}</span>` : ''}
            </div>
        `;

        const sessions = ev.sessions;
        if (!sessions) {
            listEl.innerHTML = '<div class="empty-state"><p>Nenhuma sess\u00e3o encontrada.</p></div>';
            return;
        }

        let html = '';

        // Ungrouped sessions
        if (sessions.sessions && sessions.sessions.length) {
            html += renderSessionGroup('Sess\u00f5es', sessions.sessions);
        }

        // Grouped sessions
        if (sessions.groups) {
            for (const group of sessions.groups) {
                html += renderSessionGroup(group.name, group.sessions || []);
                if (group.subGroups) {
                    for (const sub of group.subGroups) {
                        html += renderSessionGroup(`${group.name} - ${sub.name}`, sub.sessions || []);
                    }
                }
            }
        }

        listEl.innerHTML = html || '<div class="empty-state"><p>Nenhuma sess\u00e3o encontrada.</p></div>';

        listEl.querySelectorAll('.session-item').forEach(el => {
            el.addEventListener('click', () => {
                loadClassification(parseInt(el.dataset.sessionId), el.dataset.sessionName);
            });
        });
    } catch (err) {
        listEl.innerHTML = `<div class="empty-state"><p>Erro ao carregar sess\u00f5es: ${escHtml(err.message)}</p></div>`;
    }
}

function renderSessionGroup(name, sessions) {
    if (!sessions.length) return '';
    return `
        <div class="session-group">
            <div class="session-group-header">&#127937; ${escHtml(name)}</div>
            ${sessions.map(s => `
                <div class="session-item" data-session-id="${s.id}" data-session-name="${escAttr(s.name)}">
                    <div>
                        <span class="session-name">${escHtml(s.name)}</span>
                        <span class="session-type ${escAttr(s.type)}">${escHtml(s.type)}</span>
                        ${s.startTime ? `<span class="event-meta-item" style="margin-left:0.75rem"><span class="icon">&#128336;</span> ${formatDateTime(s.startTime)}</span>` : ''}
                    </div>
                    <span class="session-arrow">&#8250;</span>
                </div>
            `).join('')}
        </div>
    `;
}

// --- Load Classification ---

async function loadClassification(sessionId, sessionName) {
    currentSessionId = sessionId;
    currentSessionName = sessionName;
    showView('classification');

    const headerEl = document.getElementById('classification-header');
    const tableEl = document.getElementById('classification-table');
    headerEl.innerHTML = '';
    tableEl.innerHTML = '<div class="loading">Carregando resultados...</div>';

    try {
        const resp = await fetch(`${API_BASE}/api/sessions/${sessionId}/classification`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();

        headerEl.innerHTML = `
            <h2>${escHtml(currentEventName)} - ${escHtml(sessionName)}</h2>
            <div style="color:var(--text-secondary); font-size:0.9rem;">Tipo: ${escHtml(data.type || '')}</div>
            ${data.bestLap && data.bestLap.lapTime !== '00.000' ? `
                <div class="best-lap-info">
                    <div>
                        <div class="label">Melhor Volta</div>
                        <div class="value">${escHtml(data.bestLap.lapTime)}</div>
                    </div>
                    <div>
                        <div class="label">Piloto</div>
                        <div class="driver">${escHtml(data.bestLap.name)}</div>
                    </div>
                    ${data.bestLap.speed ? `
                        <div>
                            <div class="label">Velocidade</div>
                            <div class="driver">${data.bestLap.speed.toFixed(1)} km/h</div>
                        </div>
                    ` : ''}
                    <div>
                        <div class="label">Volta</div>
                        <div class="driver">#${data.bestLap.lapNumber}</div>
                    </div>
                </div>
            ` : ''}
        `;

        if (!data.rows || !data.rows.length) {
            tableEl.innerHTML = '<div class="empty-state"><p>Sem resultados dispon\u00edveis para esta sess\u00e3o.</p></div>';
            return;
        }

        tableEl.innerHTML = `
            <table class="results-table">
                <thead>
                    <tr>
                        <th>Pos</th>
                        <th>Piloto</th>
                        <th>N&uacute;m</th>
                        <th>Classe</th>
                        <th>Melhor Tempo</th>
                        <th>Voltas</th>
                        <th>Tempo Total</th>
                        <th>Dif</th>
                        <th>Vel. (km/h)</th>
                    </tr>
                </thead>
                <tbody>
                    ${data.rows.map(row => `
                        <tr data-session-id="${sessionId}" data-position="${row.position}" data-driver-name="${escAttr(row.name)}">
                            <td class="position-cell ${row.position <= 3 ? 'p' + row.position : ''}">${row.position}</td>
                            <td class="driver-name">${escHtml(row.name)}</td>
                            <td>${escHtml(row.startNumber || '')}</td>
                            <td>${escHtml(row.resultClass || '')}</td>
                            <td class="best-time-cell">${escHtml(row.bestTime || '-')}</td>
                            <td class="laps-cell">${row.numberOfLaps}</td>
                            <td class="total-time-cell">${escHtml(row.totalTime || '-')}</td>
                            <td class="gap-cell">${row.difference && row.difference.timeDifference !== '00.000' ? '+' + escHtml(row.difference.timeDifference) : '-'}</td>
                            <td class="speed-cell">${row.bestSpeed ? row.bestSpeed.toFixed(1) : '-'}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;

        tableEl.querySelectorAll('.results-table tbody tr').forEach(el => {
            el.addEventListener('click', () => {
                loadLapData(
                    parseInt(el.dataset.sessionId),
                    parseInt(el.dataset.position),
                    el.dataset.driverName
                );
            });
        });
    } catch (err) {
        tableEl.innerHTML = `<div class="empty-state"><p>Erro ao carregar classifica\u00e7\u00e3o: ${escHtml(err.message)}</p></div>`;
    }
}

// --- Load Lap Data ---

async function loadLapData(sessionId, finishPosition, driverName) {
    showView('lapdata');

    const headerEl = document.getElementById('lapdata-header');
    const tableEl = document.getElementById('lapdata-table');
    headerEl.innerHTML = '';
    tableEl.innerHTML = '<div class="loading">Carregando tempos de volta...</div>';

    if (lapChart) {
        lapChart.destroy();
        lapChart = null;
    }

    try {
        const resp = await fetch(`${API_BASE}/api/sessions/${sessionId}/lapdata/${finishPosition}/laps`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();

        const info = data.lapDataInfo;
        const laps = data.laps || [];

        // Find best lap
        let bestLapTime = Infinity;
        let bestLapNr = -1;
        for (const lap of laps) {
            const t = parseLapTime(lap.lapTime);
            if (t > 0 && t < bestLapTime && lap.lapNr > 1) {
                bestLapTime = t;
                bestLapNr = lap.lapNr;
            }
        }

        const validTimes = laps.filter(l => l.lapNr > 1).map(l => parseLapTime(l.lapTime)).filter(t => t > 0);
        const avgTime = validTimes.length > 0
            ? (validTimes.reduce((s, t) => s + t, 0) / validTimes.length)
            : 0;

        headerEl.innerHTML = `
            <h2>&#127937; ${escHtml(driverName)}</h2>
            <div style="color:var(--text-secondary); font-size:0.9rem;">
                ${info ? `Classe: ${escHtml(info.participantInfo?.class || '')} | N\u00ba ${escHtml(info.participantInfo?.startNr || '')} | Posi\u00e7\u00e3o: P${info.participantInfo?.fieldFinishPos || '?'}` : ''}
            </div>
            <div class="driver-stats">
                <div class="stat-card">
                    <div class="stat-label">Voltas</div>
                    <div class="stat-value">${info ? info.lapCount : laps.length}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Melhor Volta</div>
                    <div class="stat-value">${bestLapNr > 0 ? formatLapTimeFromSec(bestLapTime) : '-'}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Volta #</div>
                    <div class="stat-value">${bestLapNr > 0 ? bestLapNr : '-'}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">M\u00e9dia</div>
                    <div class="stat-value">${avgTime > 0 ? formatLapTimeFromSec(avgTime) : '-'}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Consist\u00eancia</div>
                    <div class="stat-value">${(() => { const c = calcConsistency(laps); return c === '-' ? '-' : c + '%'; })()}</div>
                </div>
            </div>
        `;

        // Render chart
        renderLapChart(laps, bestLapNr);

        // Render table
        if (!laps.length) {
            tableEl.innerHTML = '<div class="empty-state"><p>Sem dados de voltas dispon\u00edveis.</p></div>';
            return;
        }

        tableEl.innerHTML = `
            <table class="lap-table">
                <thead>
                    <tr>
                        <th>Volta</th>
                        <th>Tempo</th>
                        <th>Dif. Melhor</th>
                        <th>Vel. (km/h)</th>
                        <th>Pos.</th>
                        <th>Gap Frente</th>
                        <th>Gap Atr&aacute;s</th>
                        <th>Status</th>
                    </tr>
                </thead>
                <tbody>
                    ${laps.map(lap => {
                        const isBest = lap.lapNr === bestLapNr;
                        const isFirst = lap.lapNr === 1;
                        const pos = lap.fieldComparison ? lap.fieldComparison.position : null;
                        return `
                            <tr>
                                <td class="lap-nr">${lap.lapNr}</td>
                                <td class="lap-time ${isBest ? 'best-lap' : ''} ${isFirst ? 'first-lap' : ''}">${escHtml(lap.lapTime)}</td>
                                <td class="diff-best ${lap.diffWithBestLap === '0.000' ? 'zero' : ''}">${lap.diffWithBestLap === '0.000' ? 'BEST' : (lap.diffWithBestLap ? '+' + escHtml(lap.diffWithBestLap) : '-')}</td>
                                <td class="speed">${lap.speed ? lap.speed.toFixed(1) : '-'}</td>
                                <td class="position ${pos === 1 ? 'p1' : ''}">${pos !== null ? 'P' + pos : '-'}</td>
                                <td>${lap.fieldComparison && lap.fieldComparison.gapAhead ? escHtml(lap.fieldComparison.gapAhead.time) : '-'}</td>
                                <td>${lap.fieldComparison && lap.fieldComparison.gapBehind ? escHtml(lap.fieldComparison.gapBehind.time) : '-'}</td>
                                <td>${lap.status ? lap.status.map(s => `<span class="status-${escAttr(s.toLowerCase())}">${escHtml(s)}</span>`).join(' ') : '-'}</td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        `;
    } catch (err) {
        tableEl.innerHTML = `<div class="empty-state"><p>Erro ao carregar tempos de volta: ${escHtml(err.message)}</p></div>`;
    }
}

// --- Chart ---

function renderLapChart(laps, bestLapNr) {
    const canvas = document.getElementById('lap-chart');
    const ctx = canvas.getContext('2d');

    const filteredLaps = laps.filter(l => l.lapNr > 1);
    const labels = filteredLaps.map(l => `V${l.lapNr}`);
    const times = filteredLaps.map(l => parseLapTime(l.lapTime));
    const speeds = filteredLaps.map(l => l.speed || 0);

    const bgColors = filteredLaps.map(l =>
        l.lapNr === bestLapNr ? 'rgba(245, 158, 11, 0.8)' : 'rgba(59, 130, 246, 0.6)'
    );
    const borderColors = filteredLaps.map(l =>
        l.lapNr === bestLapNr ? '#f59e0b' : '#3b82f6'
    );

    lapChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Tempo de Volta (s)',
                    data: times,
                    backgroundColor: bgColors,
                    borderColor: borderColors,
                    borderWidth: 1,
                    yAxisID: 'y',
                    order: 2
                },
                {
                    label: 'Velocidade (km/h)',
                    data: speeds,
                    type: 'line',
                    borderColor: '#10b981',
                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                    borderWidth: 2,
                    pointRadius: 3,
                    pointBackgroundColor: '#10b981',
                    fill: true,
                    yAxisID: 'y1',
                    order: 1
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: {
                    labels: { color: '#9ca3af', font: { size: 11 } }
                },
                tooltip: {
                    callbacks: {
                        label: function(ctx) {
                            if (ctx.datasetIndex === 0) {
                                return `Tempo: ${formatLapTimeFromSec(ctx.raw)}`;
                            }
                            return `Velocidade: ${ctx.raw.toFixed(1)} km/h`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    ticks: { color: '#6b7280', font: { size: 10 } },
                    grid: { color: 'rgba(55, 65, 81, 0.3)' }
                },
                y: {
                    position: 'left',
                    title: { display: true, text: 'Tempo (s)', color: '#9ca3af' },
                    ticks: {
                        color: '#3b82f6',
                        callback: v => formatLapTimeFromSec(v)
                    },
                    grid: { color: 'rgba(55, 65, 81, 0.3)' }
                },
                y1: {
                    position: 'right',
                    title: { display: true, text: 'Vel. (km/h)', color: '#9ca3af' },
                    ticks: { color: '#10b981' },
                    grid: { drawOnChartArea: false }
                }
            }
        }
    });
}

// --- Helpers ---

function parseLapTime(timeStr) {
    if (!timeStr) return 0;
    const parts = timeStr.split(':');
    if (parts.length === 1) return parseFloat(parts[0]) || 0;
    if (parts.length === 2) return parseFloat(parts[0]) * 60 + parseFloat(parts[1]);
    return parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2]);
}

function formatLapTimeFromSec(sec) {
    if (!sec || sec <= 0) return '-';
    const m = Math.floor(sec / 60);
    const s = (sec % 60).toFixed(3);
    return m > 0 ? `${m}:${s.padStart(6, '0')}` : `${s}`;
}

function calcConsistency(laps) {
    const times = laps.filter(l => l.lapNr > 1).map(l => parseLapTime(l.lapTime)).filter(t => t > 0);
    if (times.length < 2) return '-';
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const variance = times.reduce((s, t) => s + Math.pow(t - avg, 2), 0) / times.length;
    const stdDev = Math.sqrt(variance);
    const cv = (stdDev / avg) * 100;
    return Math.max(0, (100 - cv)).toFixed(1);
}

function sportClass(sport) {
    const map = { Karting: 'karting', Car: 'car', Bike: 'bike', MX: 'mx' };
    return map[sport] || 'other';
}

function formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatDateTime(dtStr) {
    if (!dtStr) return '';
    const d = new Date(dtStr);
    return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function escHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function escAttr(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Expose functions globally
window.showView = showView;
window.goBackToSessions = goBackToSessions;
window.goBackToClassification = goBackToClassification;

// Initial load
loadEvents();
