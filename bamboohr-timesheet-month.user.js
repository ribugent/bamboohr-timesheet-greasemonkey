// ==UserScript==
// @name         BambooHR Timesheet Fill Month
// @namespace    month.timesheet.bamboohr.sconde.net
// @version      1.4
// @description  Fill BambooHR Timesheet month with templates
// @author       Sergio Conde
// @match        https://*.bamboohr.com/employees/timesheet/*
// @run-at       document-idle
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        unsafeWindow
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

  if (ENTROPY_MINUTES == null) {
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

  async function loadTimesheetData() {
    let data;

    const params = new URLSearchParams(window.location.search);
    const employeeTimesheetId = params.get('et_id');
    const employeeId = params.get('id') || unsafeWindow.Employee?.id || unsafeWindow.currentlyEditingEmployeeId;
    const payCycleId = params.get('pay_cycle_id');
    const url = new URL('/api/v1/time-tracking/timesheets/employee-timesheet-tab', window.location.origin);

    if (employeeTimesheetId) {
      url.searchParams.set('employeeTimesheetId', employeeTimesheetId);
    } else if (employeeId) {
      url.searchParams.set('employeeId', employeeId);
      if (payCycleId) url.searchParams.set('payCycleId', payCycleId);
    } else {
      throw new Error('Unable to identify the employee for this timesheet.');
    }

    const response = await fetch(url.href, {
      credentials: 'same-origin',
      cache: 'no-cache',
      headers: { accept: 'application/json' }
    });
    await checkResponse(response);
    data = await response.json();

    if (!data?.timesheet?.dailyDetails || typeof data.timesheet.dailyDetails !== 'object') {
      throw new Error('No daily details were returned for the selected timesheet.');
    }
    return data;
  }

  async function checkResponse(response) {
    if (!response.ok) {
      throw new Error(`Request error!\nHTTP Code: ${response.status}\nResponse:\n${await response.text()}`);
    }
  }

  async function saveEntries(method, entries) {
    if (!unsafeWindow.CSRF_TOKEN) {
      throw new Error('The BambooHR session token is missing. Refresh the page and try again.');
    }
    const response = await fetch(`${window.location.origin}/timesheet/clock/entries`, {
      method,
      cache: 'no-cache',
      credentials: 'same-origin',
      headers: {
        'content-type': 'application/json; charset=UTF-8',
        'x-csrf-token': unsafeWindow.CSRF_TOKEN
      },
      body: JSON.stringify({ entries })
    });
    await checkResponse(response);
  }

  async function runAction(action) {
    if (btn_fill.disabled || btn_del.disabled) return false;
    btn_fill.disabled = true;
    btn_del.disabled = true;
    try {
      await action();
    } catch (err) {
      alert(`Timesheet error!\n\n${err.message || err}`);
    } finally {
      btn_fill.disabled = false;
      btn_del.disabled = false;
    }
    return false;
  }

  btn_fill.onclick = () => runAction(async () => {
    const tsd = await loadTimesheetData();
    const employeeId = tsd.employeeId || unsafeWindow.currentlyEditingEmployeeId;
    if (!employeeId) throw new Error('Unable to identify the employee for this timesheet.');
    let skipped = [];
    let entries = [];
    let tracking_id = 0;

    for (const [day, details] of Object.entries(tsd.timesheet.dailyDetails)) {
      let date = new Date(`${day}T12:00:00`);

      /* Skip weekend */
      if ([0, 6].includes(date.getDay())) {
        continue;
      }

      /* Skip holidays & time off */
      let skip_reasons = [];

      skip_reasons.push(...(details.holidays ?? []).map(h => `${h.name.trim()} (${h.paidHours} hours)`));
      skip_reasons.push(...(details.timeOff ?? []).map(t => `${t.type.trim()} (${t.amount} ${t.unit})`));

      if (skip_reasons.length > 0) {
        skipped.push(`${day}: ${skip_reasons.join(", ")}`);
        continue;
      }

      /* Get the working time slots for the dow */
      let dow = date.toLocaleDateString("en-US", { weekday: 'short' });
      let slots = TEMPLATES['default'];

      if (Object.hasOwn(TEMPLATES, dow)) {
        slots = TEMPLATES[dow];
      }

      /* Generate the entries for this day */
      let minute_diff = Array.from({ length: slots.length }, () => Math.ceil(Math.random() * ENTROPY_MINUTES));

      for (const [idx, slot] of slots.entries()) {
        tracking_id += 1;

        let start = new Date(`${day}T${slot.start.padStart(5, '0')}:00`);
        start.setMinutes(start.getMinutes() + minute_diff[idx]);

        let end = new Date(`${day}T${slot.end.padStart(5, '0')}:00`);
        end.setMinutes(end.getMinutes() + minute_diff[minute_diff.length - 1 - idx]);

        entries.push({
          id: null,
          trackingId: tracking_id,
          employeeId,
          date: day,
          start: `${start.getHours()}:${('0' + start.getMinutes()).slice(-2)}`,
          end: `${end.getHours()}:${('0' + end.getMinutes()).slice(-2)}`,
          note: ''
        });
      }
    }

    if (entries.length === 0) {
      alert(`No entries to create.\n\nSkipped days:\n${skipped.join('\n')}`);
      return;
    }
    await saveEntries('POST', entries);
    alert(`Created ${entries.length} entries.\n\nSkipped days:\n${skipped.join('\n')}`);
    location.reload();
  });

  /* Delete Month Button */
  let btn_del = document.createElement('button');
  btn_del.type = 'button';
  btn_del.className = BUTTON_CLASSLIST;
  btn_del.style.backgroundColor = "rgb(220, 53, 69)";
  btn_del.style.color = "white";
  btn_del.style.cursor = "pointer";
  btn_del.innerText = '🗑️ Delete Month';

  btn_del.onclick = () => runAction(async () => {
    if (!confirm('Are you sure you want to delete all entries for the selected timesheet?')) {
      return false;
    }

    const tsd = await loadTimesheetData();
    let entries = [];

    /* Grab all entries ids */
    for (const details of Object.values(tsd.timesheet.dailyDetails)) {
      for (const entry of details.clockEntries ?? []) {
        entries.push(entry.id);
      }
    }

    if (entries.length === 0) {
      alert('No entries to delete.');
      return false;
    }

    await saveEntries('DELETE', entries);
    alert(`Deleted ${entries.length} entries.`);
    location.reload();
  });

 /* Add buttons - Wait for timesheet to load */
  let attemptCount = 0;
  const maxAttempts = 20; // Try for 10 seconds

  const waitForTimesheet = setInterval(() => {
    attemptCount++;

    const timesheetContainer = document.getElementById('js-timesheet');

    if (timesheetContainer) {
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
