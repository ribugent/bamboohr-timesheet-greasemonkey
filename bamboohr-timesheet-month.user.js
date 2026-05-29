// ==UserScript==
// @name         BambooHR Timesheet Fill Month
// @namespace    month.timesheet.bamboohr.sconde.net
// @version      1.3
// @description  Fill BambooHR Timesheet month with templates
// @author       Sergio Conde
// @match        https://*.bamboohr.com/employees/timesheet/*
// @grant        GM.getValue
// @grant        GM.setValue
// @homepageURL  https://github.com/skgsergio/bamboohr-timesheet-greasemonkey/
// @supportURL   https://github.com/skgsergio/bamboohr-timesheet-greasemonkey/issues
// @updateURL    https://raw.githubusercontent.com/ribugent/bamboohr-timesheet-greasemonkey/master/bamboohr-timesheet-month.user.js
// ==/UserScript==

'use strict';

/*
   Don't touch this, won't persist across updates.

   Load BambooHR for the first time with the script and then open this script Storage preferences and edit there.
 */
const DEFAULT_TEMPLATES = {
  'default': [{ start: '8:15', end: '13:00' }, { start: '13:20', end: '16:35' }]
};

const DEFAULT_ENTROPY_MINUTES = 10;

// Updated for new Fabric UI
const BUTTON_CLASSLIST = 'fab-Button fab-Button--primary fab-Button--medium';

/* Here be dragons */
(async function() {
  let TEMPLATES = await GM.getValue('TEMPLATES');

  if (!TEMPLATES) {
    TEMPLATES = DEFAULT_TEMPLATES;
    GM.setValue('TEMPLATES', TEMPLATES);
  }

  let ENTROPY_MINUTES = await GM.getValue('ENTROPY_MINUTES');

  if (!ENTROPY_MINUTES) {
    ENTROPY_MINUTES = DEFAULT_ENTROPY_MINUTES;
    GM.setValue('ENTROPY_MINUTES', ENTROPY_MINUTES);
  }

  /* Fill Month Button */
  let btn_fill = document.createElement('button');
  btn_fill.type = 'button';
  btn_fill.className = BUTTON_CLASSLIST;
  btn_fill.style.backgroundColor = "rgb(36, 130, 122)";
  btn_fill.style.color = "white";
  btn_fill.style.cursor = "pointer";
  btn_fill.style.marginRight = "8px";
  btn_fill.innerText = '📅 Fill Month';

  btn_fill.onclick = function () {
    let tsd = JSON.parse(document.getElementById('js-timesheet-data').innerHTML);
    let skipped = [];
    let entries = [];
    let tracking_id = 0;

    for (const [day, details] of Object.entries(tsd.timesheet.dailyDetails)) {
      let date = new Date(day);

      /* Skip weekend */
      if ([0, 6].includes(date.getDay())) {
        continue;
      }

      /* Skip holidays & time off */
      let skip_reasons = [];

      skip_reasons.push(...details.holidays.map(h => `${h.name.trim()} (${h.paidHours} hours)`));
      skip_reasons.push(...details.timeOff.map(t => `${t.type.trim()} (${t.amount} ${t.unit})`));

      if (skip_reasons.length > 0) {
        skipped.push(`${day}: ${skip_reasons.join(", ")}`);
        continue;
      }

      /* Get the working time slots for the dow */
      let dow = date.toLocaleDateString("en-US", { weekday: 'short' });
      let slots = TEMPLATES['default'];

      if (TEMPLATES.hasOwnProperty(dow)) {
        slots = TEMPLATES[dow];
      }

      /* Generate the entries for this day */
      let minute_diff = [...Array(slots.length)].map(_ => Math.ceil(Math.random() * ENTROPY_MINUTES));

      for (const [idx, slot] of slots.entries()) {
        tracking_id += 1;

        let start = new Date(`${day} ${slot.start}`)
        start.setMinutes(start.getMinutes() + minute_diff[idx])

        let end = new Date(`${day} ${slot.end}`)
        end.setMinutes(end.getMinutes() + minute_diff[minute_diff.length - 1 - idx])

        entries.push({
          id: null,
          trackingId: tracking_id,
          employeeId: unsafeWindow.currentlyEditingEmployeeId,
          date: day,
          start: `${start.getHours()}:${('0' + start.getMinutes()).slice(-2)}`,
          end: `${end.getHours()}:${('0' + end.getMinutes()).slice(-2)}`,
          note: ''
        });
      }
    }

    fetch(
      `${window.location.origin}/timesheet/clock/entries`,
      {
        method: 'POST',
        mode: 'cors',
        cache: 'no-cache',
        credentials: 'same-origin',
        headers: {
          'content-type': 'application/json; charset=UTF-8',
          'x-csrf-token': unsafeWindow.CSRF_TOKEN
        },
        body: JSON.stringify({ entries: entries })
      }
    ).then(data => {
      if (data.status == 200) {
        alert(`Created ${entries.length} entries.\n\nSkipped days:\n${skipped.join('\n')}`);
        location.reload();
      } else {
        data.text().then(t => alert(`Request error!\nHTTP Code: ${data.status}\nResponse:\n${t}`));
      }
    }).catch(err => alert(`Fetch error!\n\n${err}`));

    return false;
  }

  /* Delete Month Button */
  let btn_del = document.createElement('button');
  btn_del.type = 'button';
  btn_del.className = BUTTON_CLASSLIST;
  btn_del.style.backgroundColor = "rgb(220, 53, 69)";
  btn_del.style.color = "white";
  btn_del.style.cursor = "pointer";
  btn_del.innerText = '🗑️ Delete Month';

  btn_del.onclick = function () {
    if (!confirm('Are you sure you want to delete all entries for this month?')) {
      return false;
    }

    let tsd = JSON.parse(document.getElementById('js-timesheet-data').innerHTML);
    let entries = [];

    /* Grab all entries ids */
    for (const [day, details] of Object.entries(tsd.timesheet.dailyDetails)) {
      for (const entry of details.clockEntries) {
        entries.push(entry.id)
      }
    }

    if (entries.length === 0) {
      alert('No entries to delete.');
      return false;
    }

    fetch(
      `${window.location.origin}/timesheet/clock/entries`,
      {
        method: 'DELETE',
        mode: 'cors',
        cache: 'no-cache',
        credentials: 'same-origin',
        headers: {
          'content-type': 'application/json; charset=UTF-8',
          'x-csrf-token': unsafeWindow.CSRF_TOKEN
        },
        body: JSON.stringify({ entries: entries })
      }
    ).then(data => {
      if (data.status == 200) {
        alert(`Deleted ${entries.length} entries.`);
        location.reload();
      } else {
        data.text().then(t => alert(`Request error!\nHTTP Code: ${data.status}\nResponse:\n${t}`));
      }
    }).catch(err => alert(`Fetch error!\n\n${err}`));

    return false;
  }

  /* Add buttons - Wait for timesheet to load */
  let attemptCount = 0;
  const maxAttempts = 20; // Try for 10 seconds

  const waitForTimesheet = setInterval(() => {
    attemptCount++;

    // Check if timesheet data exists
    const timesheetData = document.getElementById('js-timesheet-data');
    const timesheetContainer = document.getElementById('js-timesheet');

    if (timesheetData && timesheetContainer) {
      clearInterval(waitForTimesheet);

      // Create wrapper for buttons
      const buttonWrapper = document.createElement('div');
      buttonWrapper.style.display = 'flex';
      buttonWrapper.style.gap = '8px';
      buttonWrapper.style.marginTop = '16px';
      buttonWrapper.style.marginBottom = '16px';
      buttonWrapper.style.padding = '12px';
      buttonWrapper.style.borderRadius = '4px';
      buttonWrapper.style.backgroundColor = '#f5f5f5';
      buttonWrapper.id = 'tampermonkey-timesheet-buttons';

      buttonWrapper.appendChild(btn_fill);
      buttonWrapper.appendChild(btn_del);

      // Try to find the best location for buttons
      // Option 1: Inside the timesheet container at the top
      if (timesheetContainer.children.length > 0) {
        timesheetContainer.insertBefore(buttonWrapper, timesheetContainer.firstChild);
        console.log('✅ Tampermonkey buttons added to timesheet container');
        return;
      }

      // Option 2: After the employee info column
      const infoColumn = document.querySelector('.infoColumn');
      if (infoColumn && infoColumn.nextSibling) {
        infoColumn.parentElement.insertBefore(buttonWrapper, infoColumn.nextSibling);
        console.log('✅ Tampermonkey buttons added after info column');
        return;
      }

      // Option 3: At the top of inside-content
      const insideContent = document.getElementById('inside-content');
      if (insideContent) {
        insideContent.insertBefore(buttonWrapper, insideContent.firstChild);
        console.log('✅ Tampermonkey buttons added to inside-content');
        return;
      }

      // Fallback: append to body
      document.body.appendChild(buttonWrapper);
      console.log('⚠️ Tampermonkey buttons added to body (fallback)');
    }

    // Stop trying after max attempts
    if (attemptCount >= maxAttempts) {
      clearInterval(waitForTimesheet);
      console.error('❌ Failed to find timesheet container after', maxAttempts, 'attempts');
    }
  }, 500); // Check every 500ms
})();
