(function() {
  'use strict';
  console.log('=== SCHEDULE SCRIPT STARTING ===');
  
  // Load and populate schedule from JSON
  document.addEventListener('DOMContentLoaded', function() {
    console.log('=== DOMContentLoaded fired ===');
    const scheduleContainer = document.querySelector('.scheduleContainer');
    console.log('Schedule container:', scheduleContainer);
    
    if (!scheduleContainer) {
      console.error('Schedule container not found!');
      return;
    }
    
    fetch('/assets/data/dqml2025_sessions.json')
      .then(response => {
        console.log('Fetch response:', response);
        if (!response.ok) {
          throw new Error('Network response was not ok: ' + response.statusText);
        }
        return response.json();
      })
      .then(sessions => {
        console.log('Loaded sessions:', sessions.length);
        console.log('First session:', sessions[0]);
        
        // Helper functions
        function formatTimeClass(timeStr) {
          if (!timeStr) return '';
          const [hours, minutes] = timeStr.split(':');
          const hoursNum = parseInt(hours, 10);
          const minutesNum = parseInt(minutes, 10);
          const totalMinutes = hoursNum * 60 + minutesNum;
          
          // Collapse times between 11:30 and 16:00 to 11:00 slot
          if (totalMinutes > 11 * 60 && totalMinutes < 16 * 60 + 30) {
            return '1100';
          }
          
          // Remove leading zeros from hours
          return hoursNum + minutes;
        }
        
        function subtractMinutes(timeStr, minutesToSubtract) {
          if (!timeStr) return '';
          const [hours, minutes] = timeStr.split(':').map(Number);
          let totalMinutes = hours * 60 + minutes - minutesToSubtract;
          if (totalMinutes < 0) totalMinutes = 0;
          const newHours = Math.floor(totalMinutes / 60);
          const newMinutes = totalMinutes % 60;
          return `${String(newHours).padStart(2, '0')}:${String(newMinutes).padStart(2, '0')}`;
        }
        
        function extractName(title) {
          const match = title.match(/^([^–:]+)(?:[–:]|$)/);
          return match ? match[1].trim() : title;
        }
        
        function getDayColumn(date) {
          const dayMap = {
            '2026-02-02': '2', // Monday
            '2026-02-03': '3', // Tuesday
            '2026-02-04': '4', // Wednesday
            '2026-02-05': '5'  // Thursday
          };
          return dayMap[date] || '2';
        }
        
        // Filter valid sessions
        const validSessions = sessions.filter(s => 
          s['Start (date)'] && s['Start (time)'] && 
          s['Proposal state'] !== 'withdrawn' && 
          s['Proposal state'] !== 'canceled'
        );
        
        // Group contributed talks by consecutive time blocks (session blocks)
        const contributedTalks = validSessions.filter(s => 
          s['Session type'] && s['Session type'].en === 'Contributed talk'
        ).sort((a, b) => {
          const dateCompare = a['Start (date)'].localeCompare(b['Start (date)']);
          if (dateCompare !== 0) return dateCompare;
          return a['Start (time)'].localeCompare(b['Start (time)']);
        });
        
        // Group consecutive talks into sessions
        const talkSessions = [];
        let currentSession = null;
        
        contributedTalks.forEach(talk => {
          if (!currentSession) {
            currentSession = {
              date: talk['Start (date)'],
              startTime: talk['Start (time)'],
              endTime: talk['End (time)'],
              talks: [talk]
            };
          } else {
            // Check if this talk is consecutive (within 5 minutes of previous end time)
            const prevEndMinutes = currentSession.endTime.split(':').reduce((h, m) => parseInt(h) * 60 + parseInt(m));
            const thisStartMinutes = talk['Start (time)'].split(':').reduce((h, m) => parseInt(h) * 60 + parseInt(m));
            const sameDay = talk['Start (date)'] === currentSession.date;
            
            if (sameDay && Math.abs(thisStartMinutes - prevEndMinutes) <= 5) {
              // Add to current session
              currentSession.talks.push(talk);
              currentSession.endTime = talk['End (time)'];
            } else {
              // Start new session
              talkSessions.push(currentSession);
              currentSession = {
                date: talk['Start (date)'],
                startTime: talk['Start (time)'],
                endTime: talk['End (time)'],
                talks: [talk]
              };
            }
          }
        });
        if (currentSession) {
          talkSessions.push(currentSession);
        }
        
        console.log('Talk sessions:', talkSessions.map(s => `${s.date} ${s.startTime}-${s.endTime}: ${s.talks.length} talks - ${s.talks.map(t => extractName(t['Proposal title'])).join(', ')}`));
        
        // Debug: print each session individually
        talkSessions.forEach((s, idx) => {
          console.log(`Session ${idx}: date=${s.date}, start=${s.startTime}, end=${s.endTime}, talks=${s.talks.length}`);
        });
        
        // Get unique session times (to avoid duplicates for contributed talk blocks)
        const processedSessions = new Set();
        const eventsToCreate = [];
        
        // Add contributed talk sessions
        talkSessions.forEach(session => {
          eventsToCreate.push({
            date: session.date,
            startTime: session.startTime,
            endTime: session.endTime,
            type: 'contributed',
            talks: session.talks
          });
        });
        
        // Add other session types
        validSessions.forEach(session => {
          const sessionType = session['Session type']?.en;
          const key = `${session['Start (date)']}|${session['Start (time)']}|${sessionType}`;
          
          if (sessionType === 'Contributed talk') {
            // Already processed above
            return;
          } else if (sessionType === 'Poster') {
            if (processedSessions.has(key)) return;
            processedSessions.add(key);
            
            eventsToCreate.push({
              date: session['Start (date)'],
              startTime: session['Start (time)'],
              endTime: session['End (time)'],
              type: 'poster',
              title: 'Poster session'
            });
          } else if (sessionType === 'Invited talk') {
            eventsToCreate.push({
              date: session['Start (date)'],
              startTime: session['Start (time)'],
              endTime: session['End (time)'],
              type: 'plenary',
              speaker: extractName(session['Proposal title'])
            });
          } else if (sessionType === 'Other schedule items') {
            eventsToCreate.push({
              date: session['Start (date)'],
              startTime: session['Start (time)'],
              endTime: session['End (time)'],
              type: 'other',
              title: session['Proposal title']
            });
          }
        });
        
        // Sort events by date and time
        eventsToCreate.sort((a, b) => {
          const dateCompare = a.date.localeCompare(b.date);
          if (dateCompare !== 0) return dateCompare;
          return a.startTime.localeCompare(b.startTime);
        });
        
        // Create event elements
        eventsToCreate.forEach(event => {
          const div = document.createElement('div');
          const startClass = formatTimeClass(event.startTime);
          // Subtract 30 minutes from end time (quirk of the CSS grid layout)
          const adjustedEndTime = subtractMinutes(event.endTime, 30);
          const endClass = formatTimeClass(adjustedEndTime);
          const column = getDayColumn(event.date);
          
          div.className = `event start-${startClass} end-${endClass} length-1`;
          div.style.gridColumn = column;
          
          console.log(`Creating event: ${event.type}, column: ${column}, start: ${event.startTime} (${startClass}), end: ${event.endTime} -> ${adjustedEndTime} (${endClass})`);
          
          if (event.type === 'plenary') {
            div.className += ' stage-session-type-2';
            const plenaryNum = eventsToCreate.filter(e => 
              e.type === 'plenary' && e.date <= event.date && 
              (e.date < event.date || e.startTime <= event.startTime)
            ).length;
            div.innerHTML = `Plenary ${plenaryNum} <span>${event.speaker}</span>`;
          } else if (event.type === 'contributed') {
            div.className += ' stage-session-type-1';
            const talkList = event.talks.map((talk, idx) => {
              const name = extractName(talk['Proposal title']);
              return `C${idx + 1}: ${name}`;
            }).join('<br>');
            div.innerHTML = `Contributed talks (${event.talks.length}) <span>Chair: TBA</span><span class="left">${talkList}</span>`;
          } else if (event.type === 'poster') {
            div.className += ' stage-session-type-3';
            div.textContent = event.title;
          } else if (event.type === 'other') {
            const title = event.title.toLowerCase();
            if (title.includes('opening')) {
              div.className += ' stage-opening';
              div.textContent = 'Opening remarks and lightning round';
            } else if (title.includes('discussion')) {
              div.className += ' stage-open';
              div.innerHTML = 'Discussion session';
            } else if (title.includes('poster')) {
              div.className += ' stage-session-type-3';
              div.textContent = 'Poster session';
            } else if (title.includes('powerpoint') || title.includes('karaoke')) {
              div.className += ' stage-session-type-3';
              div.textContent = 'Powerpoint karaoke';
            } else if (title.includes('closing')) {
              div.className += ' stage-opening';
              div.textContent = 'Closing remarks';
            } else {
              div.className += ' stage-open';
              div.textContent = event.title;
            }
          }
          
          scheduleContainer.appendChild(div);
        });
        
        // Add fixed schedule items (breaks, meals, arrival, departure)
        const fixedItems = [
          // Monday
          { day: '2', start: '800', end: '1100', class: 'stage-arrival', text: 'Arrival' },
          { day: '2', start: '1830', end: '1930', class: 'stage-break', text: 'Dinner' },
          
          // Tuesday  
          { day: '3', start: '800', end: '800', class: 'stage-break', text: 'Breakfast' },
          { day: '3', start: '930', end: '930', class: 'stage-break', text: 'Coffee' },
          { day: '3', start: '1100', end: '1630', class: 'stage-open', text: 'Open discussions <span>"Gradient descent methods on sloped surfaces"</span>' },
          { day: '3', start: '1700', end: '1700', class: 'stage-break', text: 'Snacks' },
          { day: '3', start: '1830', end: '1930', class: 'stage-break', text: 'Dinner' },
          
          // Wednesday
          { day: '4', start: '800', end: '800', class: 'stage-break', text: 'Breakfast' },
          { day: '4', start: '930', end: '930', class: 'stage-break', text: 'Coffee' },
          { day: '4', start: '1100', end: '1630', class: 'stage-open', text: 'Open discussions <span>"Mechanical friction at solid-liquid interfaces"</span>' },
          { day: '4', start: '1700', end: '1700', class: 'stage-break', text: 'Snacks' },
          { day: '4', start: '1830', end: '1930', class: 'stage-break', text: 'Dinner' },
          
          // Thursday
          { day: '5', start: '800', end: '800', class: 'stage-break', text: 'Breakfast' },
          { day: '5', start: '1030', end: '2130', class: 'stage-arrival', text: 'Departure' }
        ];
        
        fixedItems.forEach(item => {
          const div = document.createElement('div');
          div.className = `event ${item.class} start-${item.start} end-${item.end} length-1`;
          div.style.gridColumn = item.day;
          div.innerHTML = item.text;
          scheduleContainer.appendChild(div);
        });
        
        console.log('Schedule populated successfully');
      })
      .catch(error => {
        console.error('Error loading schedule:', error);
        alert('Error loading schedule data: ' + error.message);
      });
  });
})();
