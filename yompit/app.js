(() => {
  'use strict';
  const M = window.FinanceModel;
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const icon = name => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const escapeHTML = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const clone = value => JSON.parse(JSON.stringify(value));
  const pounds = (value, decimals = 0) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value);
  const compact = value => {
    const absolute = Math.abs(value);
    const sign = value < 0 ? '−' : '';
    if (absolute >= 1000000000000000) return `${sign}£${(absolute / 1000000000000000).toFixed(1)}q`;
    if (absolute >= 1000000000000) return `${sign}£${(absolute / 1000000000000).toFixed(1)}tn`;
    if (absolute >= 1000000000) return `${sign}£${(absolute / 1000000000).toFixed(2)}bn`;
    if (absolute >= 1000000) return `${sign}£${(absolute / 1000000).toFixed(2).replace(/\.00$/, '')}m`;
    if (absolute >= 10000) return `${sign}£${Math.round(absolute / 1000).toLocaleString('en-GB')}k`;
    return pounds(value);
  };
  const shortMoney = value => {
    if (Math.abs(value) >= 1000000000000000) return `£${+(value / 1000000000000000).toFixed(1)}q`;
    if (Math.abs(value) >= 1000000000000) return `£${+(value / 1000000000000).toFixed(1)}tn`;
    if (Math.abs(value) >= 1000000000) return `£${+(value / 1000000000).toFixed(1)}bn`;
    if (Math.abs(value) >= 1000000) return `£${+(value / 1000000).toFixed(1)}m`;
    if (Math.abs(value) >= 1000) return `£${+(value / 1000).toFixed(0)}k`;
    return pounds(value);
  };
  const displayDate = (date, options = { month: 'short', year: 'numeric' }) => new Date(date + 'T00:00:00Z').toLocaleDateString('en-GB', { ...options, timeZone: 'UTC' });
  const duration = months => {
    const years = Math.floor(months / 12), remaining = months % 12;
    return [years ? `${years} ${years === 1 ? 'year' : 'years'}` : '', remaining ? `${remaining} ${remaining === 1 ? 'month' : 'months'}` : ''].filter(Boolean).join(', ') || '0 months';
  };
  const STORAGE = 'evergreen.inputs.v2', SCENARIOS = 'evergreen.scenarios.v1';
  let storageAvailable = true;
  function readStorage(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch { storageAvailable = false; return fallback; }
  }
  function writeStorage(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch { storageAvailable = false; $('#storage-status').textContent = 'Changes kept for this session'; return false; }
  }
  let params = M.defaults();
  const restored = readStorage(STORAGE, null);
  if (restored) { try { M.validate(restored); params = restored; } catch { /* Ignore outdated or incomplete saved inputs. */ } }
  let saved = readStorage(SCENARIOS, []);
  if (!Array.isArray(saved)) saved = [];
  saved = saved.filter(item => { try { M.validate(item.params); return typeof item.name === 'string' && typeof item.id === 'string'; } catch { return false; } });
  let scenario = 'base', money = 'real', view = 'overview', showRange = true;
  let projection, lowProjection, highProjection, validParams, valid = true, chartGeometry;
  let enabledSeries = new Set(['pension', 'investment', 'mortgage', 'interestSaved']);
  let renderFrame = 0, toastTimer;
  const series = {
    pension: { label: 'Pension', color: '#467553' },
    investment: { label: 'Invested overpayments', color: '#a58bbe' },
    mortgage: { label: 'Mortgage balance', color: '#dda77b' },
    interestSaved: { label: 'Interest saved', color: '#9aab62' },
    standardMortgage: { label: 'Without overpayments', color: '#acb7a2' }
  };
  const definitions = {
    age: { label: 'Your current age', min: 18, max: 80, hardMax: 100, step: 1, unit: 'yrs', low: '18 years', high: '80 years' },
    pension: { label: 'Current pension pot', min: 0, max: 500000, hardMax: 10000000, step: 1000, currency: true, low: '£0', high: '£500k' },
    contribution: { label: 'Monthly contribution', help: 'Total amount paid in by you and your employer', min: 0, max: 5000, hardMax: 100000, step: 50, currency: true, low: '£0', high: '£5,000' },
    pensionReturn: { label: 'Annual pension growth', min: 0, max: 12, hardMin: -20, hardMax: 30, step: 0.1, unit: '%', low: '0%', high: '12%' },
    years: { label: 'Years to look ahead', min: 1, max: 50, hardMax: 60, step: 1, unit: 'yrs', low: '1 year', high: '50 years' },
    pensionLow: { label: 'Lower pension return', min: -5, max: 12, hardMin: -20, hardMax: 30, step: 0.1, unit: '%', low: '−5%', high: '12%' },
    pensionHigh: { label: 'Upper pension return', min: 0, max: 15, hardMin: -20, hardMax: 30, step: 0.1, unit: '%', low: '0%', high: '15%' },
    mortgage: { label: 'Mortgage balance', min: 0, max: 1000000, hardMax: 10000000, step: 1000, currency: true, low: '£0', high: '£1m' },
    currentRate: { label: 'Current mortgage rate', help: "You can set-up 'Future mortgage rates' in the settings below", min: 0, max: 12, hardMax: 25, step: 0.05, unit: '%', low: '0%', high: '12%' },
    requiredPayment: { label: 'Required monthly payment', min: 1, max: 6000, hardMax: 100000, step: 0.5, currency: true, low: '£1', high: '£6,000' },
    totalPayment: { label: 'Total monthly payment', help: 'Your total amount including any overpayment', min: 1, max: 8000, hardMax: 100000, step: 1, currency: true, low: '£1', high: '£8,000' },
    inflation: { label: 'Annual inflation', min: 0, max: 10, hardMin: -5, hardMax: 20, step: 0.1, unit: '%', low: '0%', high: '10%' },
    stockReturn: { label: 'Annual investment growth', min: 0, max: 15, hardMin: -20, hardMax: 30, step: 0.1, unit: '%', low: '0%', high: '15%' },
    stockLow: { label: 'Lower investment return', min: -5, max: 15, hardMin: -20, hardMax: 30, step: 0.1, unit: '%', low: '−5%', high: '15%' },
    stockHigh: { label: 'Upper investment return', min: 0, max: 20, hardMin: -20, hardMax: 30, step: 0.1, unit: '%', low: '0%', high: '20%' }
  };

  function bindTooltip(help, tooltip, hoverOnly = false) {
    const button = help.querySelector('button');
    const hoverTarget = hoverOnly ? button : help;
    const showHelp = () => { tooltip.hidden = false; };
    const hideHelp = () => { tooltip.hidden = true; };
    hoverTarget.addEventListener('pointerenter', event => { if (event.pointerType !== 'touch') showHelp(); });
    hoverTarget.addEventListener('pointerleave', () => { if (hoverOnly || !help.contains(document.activeElement)) hideHelp(); });
    if (!hoverOnly) {
      help.addEventListener('focusin', showHelp);
      help.addEventListener('focusout', event => { if (!help.contains(event.relatedTarget)) hideHelp(); });
      button.addEventListener('click', showHelp);
    }
    document.addEventListener('pointerdown', event => { if (!help.contains(event.target)) hideHelp(); });
    document.addEventListener('keydown', event => { if (event.key === 'Escape') hideHelp(); });
  }

  function buildControls() {
    $$('[data-control]').forEach(host => {
      const key = host.dataset.control, d = definitions[key];
      host.className = 'parameter-control';
      host.innerHTML = `<div class="control-top"><label for="input-${key}">${d.label}</label><div class="value-input">${d.currency ? '<span>£</span>' : ''}<input id="input-${key}" data-key="${key}" type="number" inputmode="decimal" min="${d.hardMin ?? d.min}" max="${d.hardMax ?? d.max}" step="${key === 'years' || key === 'age' ? 1 : 'any'}" class="${d.currency ? '' : 'narrow'}" aria-label="${d.label}${d.currency ? ' in pounds' : d.unit === '%' ? ' in percent' : ''}">${d.unit ? `<span class="unit-suffix">${d.unit}</span>` : ''}</div></div><input type="range" id="range-${key}" data-key="${key}" min="${d.min}" max="${d.max}" step="${d.step}" aria-label="${d.label} slider"><div class="control-limits" aria-hidden="true"><span>${d.low}</span><span>${d.high}</span></div>`;
    });
    Object.entries(definitions).forEach(([key, definition]) => {
      if (!definition.help) return;
      const label = $(`label[for="input-${key}"]`);
      const help = document.createElement('span');
      help.className = 'control-label-help';
      label.replaceWith(help);
      help.append(label);
      help.insertAdjacentHTML('beforeend', `<button type="button" class="parameter-info" aria-label="About ${escapeHTML(definition.label.toLowerCase())}" aria-describedby="${key}-help">${icon('info')}</button><span id="${key}-help" class="parameter-tooltip" role="tooltip" hidden>${escapeHTML(definition.help)}</span>`);
      const tooltip = $(`#${key}-help`);
      bindTooltip(help, tooltip);
      $(`#input-${key}`).setAttribute('aria-describedby', `${key}-help`);
      $(`#range-${key}`).setAttribute('aria-describedby', `${key}-help`);
    });
    syncControls();
    $$('input[data-key]').forEach(input => {
      input.addEventListener('input', () => {
        const key = input.dataset.key, d = definitions[key];
        if (input.type === 'number' && (input.value === '' || !input.validity.valid)) {
          markInvalid(`Enter ${d.label.toLowerCase()} between ${(d.hardMin ?? d.min).toLocaleString('en-GB')} and ${(d.hardMax ?? d.max).toLocaleString('en-GB')}.`);
          input.setAttribute('aria-invalid', 'true');
          return;
        }
        input.removeAttribute('aria-invalid');
        params[key] = Number(input.value);
        if (key === 'currentRate') {
          params.schedule[0].base = params[key];
          params.schedule[0].low = params[key];
          params.schedule[0].high = params[key];
        }
        if (input.type === 'range') $(`#input-${key}`).value = params[key];
        syncSlider(key);
        requestRender();
      });
      input.addEventListener('change', () => {
        if (input.type === 'number' && (input.value === '' || !input.validity.valid)) return;
        requestRender();
      });
    });
  }
  function syncSlider(key) {
    const slider = $(`#range-${key}`), d = definitions[key], value = params[key];
    slider.min = Math.min(d.min, value);
    slider.max = Math.max(d.max, value);
    slider.value = value;
    slider.style.setProperty('--progress', `${(value - Number(slider.min)) / (Number(slider.max) - Number(slider.min)) * 100}%`);
    slider.setAttribute('aria-valuetext', d.currency ? pounds(value, Number.isInteger(value) ? 0 : 2) : `${value}${d.unit === '%' ? ' percent' : ' years'}`);
    const limits = slider.nextElementSibling;
    limits.firstElementChild.textContent = Number(slider.min) === d.min ? d.low : d.currency ? shortMoney(Number(slider.min)) : `${slider.min}${d.unit === '%' ? '%' : ' years'}`;
    limits.lastElementChild.textContent = Number(slider.max) === d.max ? d.high : d.currency ? shortMoney(Number(slider.max)) : `${slider.max}${d.unit === '%' ? '%' : ' years'}`;
  }
  function syncControls() {
    Object.keys(definitions).forEach(key => {
      $(`#input-${key}`).value = params[key];
      $(`#input-${key}`).removeAttribute('aria-invalid');
      syncSlider(key);
    });
    $('#start-date').value = params.startDate;
  }
  function markInvalid(message) {
    valid = false;
    $('#validation-error').textContent = `${message} Showing the last valid projection until this is resolved.`;
    $('#validation-error').hidden = false;
    $('.results-panel').classList.add('is-invalid');
    $('#export').disabled = true;
    $('#storage-status').textContent = 'Check your inputs to update';
    $('#mobile-result-label').textContent = 'Check your inputs';
    $('#mobile-result-value').textContent = 'Update needed';
  }
  function requestRender() {
    cancelAnimationFrame(renderFrame);
    renderFrame = requestAnimationFrame(recalculate);
  }
  function recalculate() {
    if ($$('input[data-key][type=number]').some(input => !input.validity.valid || input.value === '')) {
      markInvalid('Complete the highlighted input with a valid number.');
      return;
    }
    try {
      M.validate(params);
      projection = M.run(params, scenario);
      lowProjection = M.run(params, 'low');
      highProjection = M.run(params, 'high');
      validParams = clone(params);
      valid = true;
      $('#validation-error').hidden = true;
      $('.results-panel').classList.remove('is-invalid');
      $('#export').disabled = false;
      const underpayment = projection.underpayment || lowProjection.underpayment || highProjection.underpayment;
      $('#model-warning').hidden = !underpayment;
      $('#model-warning').textContent = 'In at least one outlook, your total mortgage payment does not cover the interest. This model does not add unpaid interest to the balance, so mortgage results may be understated. Increase your total payment or adjust the rate schedule.';
      if (writeStorage(STORAGE, params)) $('#storage-status').textContent = 'Changes saved on this device';
      updateResults();
    } catch (error) { markInvalid(error.message); }
  }
  const valueOf = (row, key) => row[key] / (money === 'real' ? row.factor : 1);
  function updateResults() {
    if (!projection) return;
    const p = validParams, end = projection.rows.at(-1), finalPension = valueOf(end, 'pension');
    $('#pension-label').textContent = `Pension at age ${p.age + p.years}`;
    $('#pension-value').textContent = compact(finalPension);
    $('#pension-value').title = pounds(finalPension);
    updateMobileResult();
    $('#pension-growth').textContent = p.pension > 0 ? `${(finalPension / p.pension).toFixed(1)}×` : pounds(p.contribution) + '/mo';
    $('#pension-caption').textContent = p.pension > 0 ? 'today’s pension pot' : 'contributed';
    $('#projection-duration').textContent = `${p.years} years ahead`;
    const payoff = projection.payoffOver, standard = projection.payoffStandard;
    const payoffDate = payoff !== null ? M.addMonths(p.startDate, payoff) : null;
    const monthsSaved = payoff !== null ? (standard ?? projection.term) - payoff : null;
    $('#payoff-value').textContent = payoff === 0 ? 'All clear' : payoffDate ? displayDate(payoffDate) : `>${p.years} ${p.years === 1 ? 'year' : 'years'}`;
    $('#payoff-value').title = payoff !== null ? duration(payoff) + ' from the start date' : 'Mortgage is not paid off within this projection';
    const payoffDescription = $('#payoff-description');
    if (payoff === 0) payoffDescription.textContent = 'No mortgage balance to repay';
    else if (monthsSaved > 0) payoffDescription.innerHTML = `${icon('arrow')}<strong>${(monthsSaved / 12).toFixed(1)} years sooner</strong><span>with overpayments</span>`;
    else if (payoff !== null) payoffDescription.textContent = monthsSaved < 0 ? `${duration(-monthsSaved)} after the original term` : 'At the end of your original term';
    else payoffDescription.textContent = `${compact(valueOf(end, 'mortgage'))} balance at the end`;
    $('#interest-value').textContent = compact(valueOf(end, 'interestSaved'));
    $('#interest-value').title = pounds(valueOf(end, 'interestSaved'));
    $('#interest-description').textContent = `Over your ${p.years}-year projection`;
    $('#overpayment-value').textContent = pounds(p.totalPayment - p.requiredPayment, 2);
    $('#term-description').textContent = `Your inputs imply ${duration(projection.term)} remaining on your original mortgage term.`;
    $('#money-note').textContent = money === 'real' ? `Adjusted for ${p.inflation}% inflation` : 'Future values, before inflation';
    $('#freedom-title').textContent = monthsSaved > 0 ? `${(monthsSaved / 12).toFixed(1)} years more freedom.` : payoff === 0 ? 'Already mortgage-free.' : 'Your path to mortgage freedom.';
    $('#freedom-copy').innerHTML = payoffDate && payoff > 0 ? `An extra <strong>${pounds(p.totalPayment - p.requiredPayment, 2)}/month</strong> puts your mortgage-free day in <strong>${displayDate(payoffDate)}</strong>.` : payoff === 0 ? 'With no mortgage left to repay, explore what your savings could become.' : `Your <strong>${pounds(p.totalPayment)}/month</strong> payment leaves <strong>${compact(valueOf(end, 'mortgage'))}</strong> at the end. Try adjusting it.`;
    $('#investment-copy').innerHTML = `That same <strong>${pounds(p.totalPayment - p.requiredPayment, 2)}/month</strong> could become <strong>${compact(valueOf(end, 'investment'))}</strong> over ${p.years} years ${money === 'real' ? 'in today’s money' : 'before inflation'}.`;
    $('#chart-subtitle').textContent = view === 'pension' ? 'What your contributions could become.' : view === 'mortgage' ? 'Two paths to your mortgage-free day.' : 'Your pension, mortgage and investments over time.';
    $('#range-note').textContent = showRange ? 'Shaded areas show the lower and upper assumptions.' : 'Based on your selected outlook and assumptions.';
    $('#timeline').max = p.years * 12;
    $('#timeline').value = Math.min(Number($('#timeline').value), p.years * 12);
    updateTimeline();
    renderLegend();
    drawChart();
    renderTable();
    updateScenarioCount();
  }

  function viewSeries() { return view === 'pension' ? ['pension'] : view === 'mortgage' ? ['mortgage', 'standardMortgage', 'interestSaved'] : ['pension', 'investment', 'mortgage', 'interestSaved']; }
  function renderLegend() {
    $('#chart-legend').innerHTML = viewSeries().map(key => `<button data-series="${key}" aria-pressed="${enabledSeries.has(key)}"><span class="legend-dot ${key}" style="background:${series[key].color}"></span>${series[key].label}</button>`).join('');
  }
  function niceStep(range, count) {
    const rough = (range || 100) / count;
    const magnitude = Math.pow(10, Math.floor(Math.log10(rough)));
    const normalized = rough / magnitude;
    return (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10) * magnitude;
  }
  function drawChart() {
    if (!projection) return;
    const container = $('#chart-container'), svg = $('#projection-chart');
    const width = Math.max(container.clientWidth, 250), height = container.clientHeight;
    const margin = { left: width < 480 ? 43 : 57, right: 18, top: 37, bottom: 36 };
    const pw = width - margin.left - margin.right, ph = height - margin.top - margin.bottom;
    const keys = viewSeries().filter(key => enabledSeries.has(key));
    let maximum = 0, minimum = 0;
    // Include the full range in the scale even when its shading is hidden.
    const allProjections = [projection, lowProjection, highProjection];
    for (const data of allProjections) for (const row of data.rows) for (const key of keys) {
      const v = valueOf(row, key); maximum = Math.max(maximum, v); minimum = Math.min(minimum, v);
    }
    const step = niceStep(maximum - minimum, 4);
    maximum = Math.max(step, Math.ceil(maximum / step) * step);
    minimum = Math.floor(minimum / step) * step;
    const x = month => margin.left + month / (validParams.years * 12) * pw;
    const y = value => margin.top + ph - (value - minimum) / (maximum - minimum) * ph;
    const path = (data, key) => data.rows.map((row, i) => `${i ? 'L' : 'M'}${x(row.month).toFixed(2)},${y(valueOf(row, key)).toFixed(2)}`).join(' ');
    let out = `<title id="chart-title">${escapeHTML(view === 'mortgage' ? 'Mortgage repayment comparison' : view === 'pension' ? 'Pension growth projection' : 'Your financial projection')}</title><desc id="chart-desc">${validParams.years}-year ${scenario === 'base' ? 'balanced' : scenario === 'low' ? 'cautious' : 'optimistic'} projection in ${money === 'real' ? 'today’s' : 'future'} pounds. End pension ${pounds(valueOf(projection.rows.at(-1), 'pension'))}. Use the timeline slider or yearly table for exact values.</desc><defs><linearGradient id="pension-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="#7eaa66" stop-opacity=".10"/><stop offset="100%" stop-color="#7eaa66" stop-opacity=".005"/></linearGradient><clipPath id="plot-clip"><rect x="${margin.left}" y="${margin.top - 2}" width="${pw + 2}" height="${ph + 4}"/></clipPath></defs>`;
    for (let val = minimum; val <= maximum + step / 10; val += step) {
      out += `<line x1="${margin.left}" y1="${y(val)}" x2="${width - margin.right}" y2="${y(val)}" class="chart-grid"/><text x="${margin.left - 12}" y="${y(val) + 3}" class="axis-label" text-anchor="end">${shortMoney(val)}</text>`;
    }
    const tickCount = width < 480 ? 4 : 6;
    const years = validParams.years;
    for (let i = 0; i <= tickCount; i++) {
      const month = Math.round(years * 12 * i / tickCount);
      const year = Number(M.addMonths(validParams.startDate, month).slice(0, 4));
      const tickLabel = years <= 2 ? displayDate(M.addMonths(validParams.startDate, month), { month: 'short', year: '2-digit' }) : year;
      out += `<text x="${x(month)}" y="${height - 13}" class="axis-label" text-anchor="${i === 0 ? 'start' : i === tickCount ? 'end' : 'middle'}">${tickLabel}</text>`;
    }
    out += '<g clip-path="url(#plot-clip)">';
    if (keys.includes('pension')) out += `<path d="${path(projection, 'pension')} L${x(years * 12)},${y(0)} L${x(0)},${y(0)} Z" fill="url(#pension-fill)"/>`;
    if (showRange) for (const key of keys) {
      const pointsLow = lowProjection.rows.map((row, i) => `${i ? 'L' : 'M'}${x(row.month).toFixed(2)},${y(Math.min(valueOf(row, key), valueOf(highProjection.rows[i], key))).toFixed(2)}`);
      const pointsHigh = highProjection.rows.map((row, i) => `L${x(row.month).toFixed(2)},${y(Math.max(valueOf(row, key), valueOf(lowProjection.rows[i], key))).toFixed(2)}`).reverse();
      out += `<path d="${pointsLow.join(' ')} ${pointsHigh.join(' ')} Z" fill="${series[key].color}" opacity="${key === 'pension' ? '.12' : '.10'}"/>`;
    }
    for (const key of [...keys].reverse()) out += `<path d="${path(projection, key)}" stroke="${series[key].color}" class="chart-line" ${key === 'interestSaved' || key === 'standardMortgage' ? 'stroke-dasharray="4 4" style="stroke-width:1.8"' : ''}/>`;
    out += '</g>';
    if (projection.payoffOver > 0 && view !== 'pension' && keys.includes('mortgage')) {
      const px = x(projection.payoffOver), labelWidth = width < 480 ? 107 : 120;
      const pillX = Math.min(Math.max(px - labelWidth / 2, margin.left + 2), width - margin.right - labelWidth);
      out += `<line x1="${px}" y1="${margin.top - 3}" x2="${px}" y2="${y(0)}" stroke="#9ba68c" stroke-width="1" stroke-dasharray="3 4"/><rect x="${pillX}" y="8" width="${labelWidth}" height="22" rx="5" fill="#f1f5e9"/><circle cx="${pillX + 10}" cy="19" r="2.5" fill="#8b9d70"/><text x="${pillX + 18}" y="22" fill="#7b8e65" font-size="${width < 480 ? 7.5 : 8.5}">Mortgage-free · ${M.addMonths(validParams.startDate, projection.payoffOver).slice(0, 4)}</text>`;
    }
    out += `<g id="chart-hover" style="display:none"><line id="hover-line" y1="${margin.top}" y2="${margin.top + ph}" stroke="#96a189" stroke-dasharray="3 3"/><g id="hover-dots"></g></g>`;
    if (!keys.length) out += `<text x="${width / 2}" y="${height / 2}" text-anchor="middle" fill="#8f9b82" font-size="11">Select a legend item to see its projection.</text>`;
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.innerHTML = out;
    chartGeometry = { width, height, margin, pw, ph, x, y, keys };
    $('#chart-tooltip').hidden = true;
  }
  function hoverChart(event) {
    if (!chartGeometry || !projection) return;
    const g = chartGeometry, rect = $('#projection-chart').getBoundingClientRect();
    const pointerX = event.clientX - rect.left;
    if (pointerX < g.margin.left || pointerX > g.width - g.margin.right || !g.keys.length) { hideHover(); return; }
    const month = Math.round((pointerX - g.margin.left) / g.pw * validParams.years * 12);
    const row = projection.rows[month], px = g.x(month);
    $('#chart-hover').style.display = '';
    $('#hover-line').setAttribute('x1', px); $('#hover-line').setAttribute('x2', px);
    $('#hover-dots').innerHTML = g.keys.map(key => `<circle cx="${px}" cy="${g.y(valueOf(row, key))}" r="4" fill="${series[key].color}" stroke="white" stroke-width="2"/>`).join('');
    const tip = $('#chart-tooltip');
    tip.innerHTML = `<strong class="tooltip-title">${displayDate(row.date)} <span style="font-weight:400;color:#98a08f">· age ${Math.floor(row.age)}</span></strong>${g.keys.map(key => `<div class="tooltip-row"><span><i class="legend-dot ${key}" style="background:${series[key].color}"></i>${series[key].label}</span><strong>${pounds(valueOf(row, key))}</strong></div>`).join('')}`;
    tip.hidden = false;
    const tipWidth = tip.offsetWidth;
    tip.style.left = `${Math.max(2, Math.min(px + 15, g.width - tipWidth - 4))}px`;
    tip.style.top = '39px';
  }
  function hideHover() { if ($('#chart-hover')) $('#chart-hover').style.display = 'none'; $('#chart-tooltip').hidden = true; }
  function updateTimeline() {
    if (!projection) return;
    const slider = $('#timeline'), row = projection.rows[Number(slider.value)];
    $('#timeline-label').textContent = `${displayDate(row.date)} · age ${Math.floor(row.age)}`;
    slider.setAttribute('aria-valuetext', `${displayDate(row.date)}, age ${Math.floor(row.age)}`);
    slider.style.setProperty('--progress', `${Number(slider.value) / Number(slider.max) * 100}%`);
    $('#timeline-values').innerHTML = ['pension', 'mortgage', 'interestSaved', 'investment'].map(key => `<div>${series[key].label}<strong>${pounds(valueOf(row, key))}</strong></div>`).join('');
  }
  function renderTable() {
    if (!projection) return;
    $('#table-caption').textContent = `Annual balances in ${money === 'real' ? 'today’s' : 'future'} money · ${scenario === 'base' ? 'Balanced' : scenario === 'low' ? 'Cautious' : 'Optimistic'} outlook`;
    $('#yearly-table').innerHTML = projection.rows.filter(row => row.month % 12 === 0).map(row => `<tr><td>${displayDate(row.date)}<span>Age ${row.age}</span></td>${['pension', 'mortgage', 'standardMortgage', 'interestSaved', 'investment'].map(key => `<td>${pounds(valueOf(row, key))}</td>`).join('')}</tr>`).join('');
  }

  function activatePanel(name, focus = false) {
    $$('[data-panel]').forEach(button => {
      const selected = button.dataset.panel === name;
      button.setAttribute('aria-selected', selected); button.tabIndex = selected ? 0 : -1;
      $(`#panel-${button.dataset.panel}`).hidden = !selected;
      if (selected && focus) button.focus();
    });
    updateMobileResult();
  }
  function updateMobileResult() {
    if (!projection || !valid) return;
    const panel = $('[data-panel][aria-selected=true]').dataset.panel;
    const end = projection.rows.at(-1), p = validParams;
    $('#mobile-result-label').textContent = panel === 'mortgage' ? 'Mortgage-free by' : panel === 'outlook' ? 'Invested instead' : `Pension at age ${p.age + p.years}`;
    $('#mobile-result-value').textContent = panel === 'mortgage'
      ? projection.payoffOver === 0 ? 'All clear' : projection.payoffOver === null ? `>${p.years} ${p.years === 1 ? 'year' : 'years'}` : displayDate(M.addMonths(p.startDate, projection.payoffOver))
      : compact(valueOf(end, panel === 'outlook' ? 'investment' : 'pension'));
  }
  function expandMobileControls(expanded) {
    $('.controls-panel').classList.toggle('mobile-expanded', expanded);
    document.body.classList.toggle('editing-inputs', expanded);
    $('#mobile-controls-toggle').setAttribute('aria-expanded', expanded);
    $('#mobile-controls-toggle span').textContent = expanded ? 'Hide' : 'Adjust';
  }
  function setView(nextView) {
    view = nextView;
    enabledSeries = new Set(viewSeries());
    $$('[data-view]').forEach(button => { const active = button.dataset.view === view; button.classList.toggle('active', active); button.setAttribute('aria-pressed', active); });
    updateResults();
  }
  function notify(message) {
    clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').hidden = false;
    toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 3600);
  }
  function openDialog(id) { $(id).showModal(); }
  function closeDialog(dialog) { dialog.close(); }
  function updateScenarioCount() { $('#scenario-count').hidden = !saved.length; $('#scenario-count').textContent = saved.length; }
  function renderSavedScenarios() {
    updateScenarioCount();
    $('#saved-scenarios').innerHTML = saved.length ? saved.map(item => `<article class="saved-item"><div><h3>${escapeHTML(item.name)}</h3><p>${item.params.years} years · ${pounds(item.params.contribution)}/mo pension · ${pounds(item.params.totalPayment)}/mo mortgage</p></div><button class="button button-light" data-load="${escapeHTML(item.id)}">Load</button><button class="icon-button" data-delete="${escapeHTML(item.id)}" aria-label="Delete ${escapeHTML(item.name)}">${icon('close')}</button></article>`).join('') : '<p class="empty-scenarios">Your possibilities will live here.<br>Save your first scenario above.</p>';
  }
  function renderSchedule(schedule) {
    $('#schedule-rows').innerHTML = schedule.map((row, i) => `<tr><td><input type="date" value="${escapeHTML(row.date)}" data-rate="date" required aria-label="Period ${i + 1} start date"></td>${['low', 'base', 'high'].map(key => `<td><input type="number" inputmode="decimal" value="${row[key]}" min="0" max="25" step="any" data-rate="${key}" required aria-label="Period ${i + 1} ${key === 'base' ? 'base' : key === 'low' ? 'lower' : 'upper'} rate"></td>`).join('')}<td><button type="button" class="icon-button" data-remove-rate="${i}" aria-label="Remove rate period ${i + 1}" ${schedule.length === 1 ? 'disabled' : ''}>${icon('close')}</button></td></tr>`).join('');
  }
  function readSchedule() {
    return $$('#schedule-rows tr').map(row => ({ date: row.querySelector('[data-rate=date]').value, ...Object.fromEntries(['low', 'base', 'high'].map(key => [key, row.querySelector(`[data-rate=${key}]`).value === '' ? NaN : Number(row.querySelector(`[data-rate=${key}]`).value)])) }));
  }
  function exportProjection() {
    if (!valid || !projection) { notify('Check your inputs before exporting.'); return; }
    const p = validParams;
    const csvRows = [['Further financial projection'], ['Outlook', scenario === 'base' ? 'Balanced' : scenario === 'low' ? 'Cautious' : 'Optimistic'], ['Values', money === 'real' ? 'Today’s GBP (inflation-adjusted)' : 'Future GBP (nominal)'], [], ['Assumptions'], ['Start date', p.startDate], ...Object.keys(definitions).map(key => [definitions[key].label + (definitions[key].currency ? ' (GBP)' : definitions[key].unit === '%' ? ' (%)' : ''), p[key]]), [], ['Mortgage rate schedule'], ['From', 'Lower rate (%)', 'Base rate (%)', 'Upper rate (%)'], ...p.schedule.map(row => [row.date, row.low, row.base, row.high]), [], ['Summary'], ['Original term (months)', projection.term], ['Mortgage payoff with overpayments (months)', projection.payoffOver ?? 'Beyond projection'], ['Mortgage payoff without overpayments (months)', projection.payoffStandard ?? 'Beyond projection'], ['Model warning', projection.underpayment ? 'Payment does not cover interest in some months; balances may be understated.' : 'None in selected outlook'], [], ['Month', 'Date', 'Age', 'Pension (GBP)', 'Mortgage with overpayments (GBP)', 'Mortgage without overpayments (GBP)', 'Cumulative interest saved (GBP)', 'Invested overpayments (GBP)', 'Mortgage annual rate (%)', 'Inflation factor'], ...projection.rows.map(row => [row.month, row.date, row.age.toFixed(2), ...['pension', 'mortgage', 'standardMortgage', 'interestSaved', 'investment'].map(key => valueOf(row, key).toFixed(2)), (row.rate * 100).toFixed(4), row.factor.toFixed(6)]), [], ['Model notes'], ['Contributions are fixed in nominal GBP and made at the start of each month.'], ['The overpayment difference is invested throughout the full projection. Released mortgage payments are not reinvested.'], ['Mortgage interest uses an effective monthly rate. Taxes, withdrawals, contribution growth, fees and overpayment charges are not modelled.'], ['Scenario ranges are assumptions, not confidence intervals. This is a planning model, not financial advice.']];
    const csv = '\uFEFF' + csvRows.map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' }), url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = `further-projection-${p.startDate}-${scenario}-${money}.csv`; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    notify('Your projection is ready. CSV download started.');
  }

  buildControls();
  bindTooltip($('.money-help'), $('#today-money-help'), true);
  $$('[data-panel]').forEach(button => button.addEventListener('click', () => activatePanel(button.dataset.panel)));
  $('.control-tabs').addEventListener('keydown', event => {
    const tabs = $$('[data-panel]'), index = tabs.indexOf(document.activeElement);
    if (index < 0) return;
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else return;
    event.preventDefault(); activatePanel(tabs[next].dataset.panel, true);
  });
  $('#start-date').addEventListener('input', event => { params.startDate = event.target.value; requestRender(); });
  $$('[data-money]').forEach(button => button.addEventListener('click', () => {
    money = button.dataset.money;
    $$('[data-money]').forEach(b => { b.classList.toggle('active', b === button); b.setAttribute('aria-pressed', b === button); });
    updateResults();
  }));
  $$('[data-view]').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
  $('#show-range').addEventListener('change', event => { showRange = event.target.checked; updateResults(); });
  $('#scenario-select').addEventListener('change', event => { scenario = event.target.value; requestRender(); });
  $('#chart-legend').addEventListener('click', event => {
    const button = event.target.closest('[data-series]'); if (!button) return;
    const key = button.dataset.series; if (enabledSeries.has(key)) enabledSeries.delete(key); else enabledSeries.add(key);
    button.setAttribute('aria-pressed', enabledSeries.has(key)); drawChart();
  });
  $('#projection-chart').addEventListener('pointermove', hoverChart);
  $('#projection-chart').addEventListener('pointerdown', hoverChart);
  $('#projection-chart').addEventListener('pointerleave', hideHover);
  $('#projection-chart').addEventListener('pointercancel', hideHover);
  $('#timeline').addEventListener('input', updateTimeline);
  $('#reset').addEventListener('click', () => {
    params = M.defaults(); scenario = 'base'; $('#scenario-select').value = 'base'; syncControls(); recalculate(); notify('Default inputs restored.');
  });
  $('#adjust-overpayment').addEventListener('click', () => {
    expandMobileControls(true); activatePanel('mortgage'); setView('mortgage'); $('#input-totalPayment').focus({ preventScroll: true });
    $('.controls-panel').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
  });
  $('#explore-investment').addEventListener('click', () => {
    expandMobileControls(true); activatePanel('outlook'); setView('overview'); enabledSeries = new Set(['investment']); renderLegend(); drawChart();
    $('.chart-card').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
    notify('Showing the investment alternative. Adjust growth in Outlook.');
  });
  $('#how-it-works').addEventListener('click', () => openDialog('#notes-dialog'));
  $('#model-notes').addEventListener('click', () => openDialog('#notes-dialog'));
  $$('[data-close]').forEach(button => button.addEventListener('click', () => closeDialog(button.closest('dialog'))));
  $$('dialog').forEach(dialog => dialog.addEventListener('click', event => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeDialog(dialog); } }));
  $('#save-scenario').addEventListener('click', () => { renderSavedScenarios(); openDialog('#scenarios-dialog'); });
  $('#scenario-form').addEventListener('submit', event => {
    event.preventDefault();
    if (!valid) { notify('Resolve the input error before saving a scenario.'); return; }
    const name = $('#scenario-name').value.trim(); if (!name) { $('#scenario-name').value = ''; $('#scenario-name').reportValidity(); return; }
    saved.unshift({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, name, params: clone(params), scenario, money, created: new Date().toISOString() });
    const persisted = writeStorage(SCENARIOS, saved); $('#scenario-name').value = ''; renderSavedScenarios();
    notify(persisted ? 'Scenario saved. Make room for another possibility.' : 'Scenario kept for this session. Browser storage is unavailable.');
  });
  $('#saved-scenarios').addEventListener('click', event => {
    const loadButton = event.target.closest('[data-load]'), deleteButton = event.target.closest('[data-delete]');
    if (loadButton) {
      const item = saved.find(s => s.id === loadButton.dataset.load); if (!item) return;
      params = clone(item.params); scenario = ['low', 'base', 'high'].includes(item.scenario) ? item.scenario : 'base'; money = item.money === 'nominal' ? 'nominal' : 'real';
      $('#scenario-select').value = scenario; $$('[data-money]').forEach(b => { b.classList.toggle('active', b.dataset.money === money); b.setAttribute('aria-pressed', b.dataset.money === money); });
      syncControls(); recalculate(); closeDialog($('#scenarios-dialog')); notify(`Loaded “${item.name}”.`);
    }
    if (deleteButton) { saved = saved.filter(s => s.id !== deleteButton.dataset.delete); writeStorage(SCENARIOS, saved); renderSavedScenarios(); notify('Scenario removed.'); }
  });
  $('#edit-schedule').addEventListener('click', () => { renderSchedule(params.schedule); $('#schedule-error').hidden = true; openDialog('#schedule-dialog'); });
  $('#add-rate').addEventListener('click', () => {
    const rows = readSchedule();
    if (rows.length >= 30) { notify('You can add up to 30 rate periods.'); return; }
    const last = rows.at(-1); let date;
    try { date = M.addMonths(last.date, 36); } catch { date = M.addMonths(params.startDate, 36); }
    rows.push({ date, low: Number.isFinite(last.low) ? last.low : 3.5, base: Number.isFinite(last.base) ? last.base : 4, high: Number.isFinite(last.high) ? last.high : 4.5 });
    renderSchedule(rows); $('#schedule-rows tr:last-child input').focus();
  });
  $('#schedule-rows').addEventListener('click', event => {
    const button = event.target.closest('[data-remove-rate]'); if (!button) return;
    const rows = readSchedule(); if (rows.length <= 1) return;
    rows.splice(Number(button.dataset.removeRate), 1); renderSchedule(rows);
  });
  $('#schedule-form').addEventListener('submit', event => {
    event.preventDefault();
    const schedule = readSchedule().sort((a, b) => a.date.localeCompare(b.date));
    try {
      const candidate = { ...params, schedule };
      M.validate(candidate); params = candidate; recalculate(); closeDialog($('#schedule-dialog')); notify('Mortgage rate schedule updated.');
    } catch (error) { $('#schedule-error').textContent = error.message; $('#schedule-error').hidden = false; }
  });
  $('#export').addEventListener('click', exportProjection);
  $('#mobile-controls-toggle').addEventListener('click', () => expandMobileControls(!$('.controls-panel').classList.contains('mobile-expanded')));
  $('#view-projection').addEventListener('click', () => {
    expandMobileControls(false);
    $('.results-panel').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
  });
  if (!storageAvailable) $('#storage-status').textContent = 'Changes kept for this session';
  recalculate();
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => { requestAnimationFrame(drawChart); }).observe($('#chart-container'));
  else window.addEventListener('resize', drawChart);
})();
