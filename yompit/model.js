(function (root) {
  'use strict';

  function localDate() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function defaults() {
    const mortgage = 350000, currentRate = 5.3;
    // Estimate repayment over 25 years using the model's monthly rate convention.
    // Round up to the penny so the inferred term does not gain an extra month.
    const requiredPayment = Math.ceil(amortisingPayment(mortgage, currentRate / 100, 25 * 12) * 100) / 100;
    return {
      startDate: localDate(), years: 30, age: 35,
      pension: 60000, contribution: 500,
      pensionReturn: 5.5, pensionLow: 3.5, pensionHigh: 7.5,
      mortgage, currentRate, requiredPayment, totalPayment: Number((requiredPayment + 100).toFixed(2)),
      inflation: 2.5, stockReturn: 6.5, stockLow: 4.5, stockHigh: 8.5,
      schedule: [
        { date: '2026-01-01', low: currentRate, base: currentRate, high: currentRate },
        { date: '2027-03-01', low: 4.25, base: 4.75, high: 5.25 },
        { date: '2030-03-01', low: 4, base: 4.5, high: 5 },
        { date: '2032-03-01', low: 3.75, base: 4.25, high: 4.75 },
        { date: '2037-03-01', low: 3.5, base: 4, high: 4.5 }
      ]
    };
  }

  const monthlyRate = annual => Math.pow(1 + annual, 1 / 12) - 1;
  function addMonths(start, months) {
    const [y, m, d] = start.split('-').map(Number);
    const result = new Date(Date.UTC(y, m - 1 + months, Math.min(d, 28)));
    return result.toISOString().slice(0, 10);
  }
  function inferTerm(balance, annualRate, payment) {
    if (balance <= 0) return 0;
    const r = monthlyRate(annualRate);
    if (payment <= balance * r) throw new Error('The required payment must cover the current monthly interest. Increase it or lower the mortgage balance.');
    if (r === 0) return Math.ceil(balance / payment);
    return Math.ceil(-Math.log(1 - balance * r / payment) / Math.log(1 + r));
  }
  function amortisingPayment(balance, rate, months) {
    if (balance <= 0 || months <= 0) return 0;
    const r = monthlyRate(rate);
    return r === 0 ? balance / months : balance * r / (1 - Math.pow(1 + r, -months));
  }
  function stepMortgage(balance, rate, payment) {
    if (balance <= 0) return [0, 0];
    const interest = balance * monthlyRate(rate);
    const next = Math.max(balance - Math.max(payment - interest, 0), 0);
    return [next < 1e-8 ? 0 : next, payment > 0 ? interest : 0];
  }
  function validDate(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      Number.isFinite(Date.parse(value)) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
  }
  function validate(p) {
    const limits = {
      years: [1, 60], age: [18, 100], pension: [0, 10000000], contribution: [0, 100000],
      pensionReturn: [-20, 30], pensionLow: [-20, 30], pensionHigh: [-20, 30],
      mortgage: [0, 10000000], currentRate: [0, 25], requiredPayment: [1, 100000],
      totalPayment: [1, 100000], inflation: [-5, 20], stockReturn: [-20, 30], stockLow: [-20, 30], stockHigh: [-20, 30]
    };
    for (const [key, [min, max]] of Object.entries(limits)) {
      if (!Number.isFinite(p[key]) || p[key] < min || p[key] > max) throw new Error(`Enter a valid ${key.replace(/([A-Z])/g, ' $1').toLowerCase()} between ${min.toLocaleString('en-GB')} and ${max.toLocaleString('en-GB')}.`);
    }
    if (!Number.isInteger(p.years) || !Number.isInteger(p.age)) throw new Error('Use whole numbers for your age and projection length.');
    if (!validDate(p.startDate) || p.startDate < '1900-01-01' || p.startDate > '2200-12-31') throw new Error('Choose a valid start date between 1900 and 2200.');
    if (p.totalPayment < p.requiredPayment) throw new Error('Total mortgage payment must be at least the required payment. You can adjust both in the Mortgage tab.');
    for (const [low, base, high, name] of [[p.pensionLow, p.pensionReturn, p.pensionHigh, 'pension'], [p.stockLow, p.stockReturn, p.stockHigh, 'investment']]) {
      if (low > base || high < base) throw new Error(`Keep the ${name} return between its lower and upper assumptions, or adjust the return range.`);
    }
    if (!Array.isArray(p.schedule) || !p.schedule.length || p.schedule.length > 30) throw new Error('Add between 1 and 30 mortgage rate periods.');
    let previous = '';
    for (const row of p.schedule) {
      if (!validDate(row.date) || row.date <= previous) throw new Error('Mortgage rate dates must be valid, distinct, and in chronological order.');
      previous = row.date;
      if (![row.low, row.base, row.high].every(r => Number.isFinite(r) && r >= 0 && r <= 25)) throw new Error('Mortgage schedule rates must be between 0% and 25%.');
      if (row.low > row.base || row.high < row.base) throw new Error('Each mortgage rate must sit between its lower and upper assumptions.');
    }
    inferTerm(p.mortgage, p.currentRate / 100, p.requiredPayment);
  }

  function run(p, scenario = 'base') {
    validate(p);
    const term = inferTerm(p.mortgage, p.currentRate / 100, p.requiredPayment);
    const pReturn = scenario === 'low' ? p.pensionLow : scenario === 'high' ? p.pensionHigh : p.pensionReturn;
    const sReturn = scenario === 'low' ? p.stockLow : scenario === 'high' ? p.stockHigh : p.stockReturn;
    const rateKey = scenario === 'low' ? 'high' : scenario === 'high' ? 'low' : 'base';
    const pr = monthlyRate(pReturn / 100), sr = monthlyRate(sReturn / 100);
    let pension = p.pension, investment = 0, over = p.mortgage, standard = p.mortgage;
    let interestOver = 0, interestStandard = 0;
    let payoffOver = p.mortgage === 0 ? 0 : null, payoffStandard = p.mortgage === 0 ? 0 : null;
    let underpayment = false;
    const rows = [];
    for (let month = 0; month <= p.years * 12; month++) {
      const date = addMonths(p.startDate, month);
      let rate = p.schedule[0][rateKey] / 100;
      for (const period of p.schedule) {
        if (date >= period.date) rate = period[rateKey] / 100;
        else break;
      }
      const factor = Math.pow(1 + p.inflation / 100, month / 12);
      rows.push({ month, date, age: p.age + month / 12, factor, pension, investment,
        mortgage: over, standardMortgage: standard, interestSaved: interestStandard - interestOver, rate });
      if (month === p.years * 12) break;
      pension = (pension + p.contribution) * (1 + pr);
      investment = (investment + p.totalPayment - p.requiredPayment) * (1 + sr);
      const payment = amortisingPayment(standard, rate, Math.max(term - month, 1));
      let interest;
      [standard, interest] = stepMortgage(standard, rate, payment);
      interestStandard += interest;
      if (standard === 0 && payoffStandard === null) payoffStandard = month + 1;
      if (over > 0 && p.totalPayment <= over * monthlyRate(rate)) underpayment = true;
      const actual = Math.min(p.totalPayment, over * (1 + monthlyRate(rate)));
      [over, interest] = stepMortgage(over, rate, actual);
      interestOver += interest;
      if (over === 0 && payoffOver === null) payoffOver = month + 1;
    }
    return { rows, term, payoffOver, payoffStandard, interestOver, interestStandard, interestSaved: interestStandard - interestOver, underpayment };
  }

  const api = { defaults, monthlyRate, addMonths, inferTerm, amortisingPayment, stepMortgage, validate, run };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FinanceModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
