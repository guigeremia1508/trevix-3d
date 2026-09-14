function nonNegative(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function calculateQuoteCosts(input = {}) {
  const qty = Math.max(1, Number.parseInt(input.quantity, 10) || 1);
  const weight = nonNegative(input.weight_g);
  const printTime = nonNegative(input.print_time_min);
  const projectTime = nonNegative(input.project_time_min);
  const laborExtra = nonNegative(input.labor_extra ?? input.labor_cost);
  const other = nonNegative(input.other_costs);
  const materialCostPerGram = nonNegative(input.cost_per_gram);
  const powerWatts = nonNegative(input.power_watts);
  const energyTariff = nonNegative(input.energy_cost_kwh);
  const machineRate = nonNegative(input.machine_cost_hour);
  const maintenanceRate = nonNegative(input.maintenance_cost_hour);
  const laborRate = nonNegative(input.labor_cost_hour);

  const hours = (printTime * qty) / 60;
  const material = weight * qty * materialCostPerGram;
  const energy = (powerWatts / 1000) * hours * energyTariff;
  const machine = hours * machineRate;
  const maintenance = hours * maintenanceRate;
  const labor = (projectTime / 60) * laborRate + laborExtra;
  const total = material + energy + machine + maintenance + labor + other;

  const priceMode = input.price_mode === 'direct' ? 'direct' : 'markup';
  const markup = Math.max(0, Number(input.markup_percent) || 0);
  const directPrice = nonNegative(input.price_total);
  const price = priceMode === 'direct' ? directPrice : total * (1 + markup / 100);
  const profit = price - total;
  const realMargin = price > 0 ? (profit / price) * 100 : 0;

  return {
    qty,
    weight,
    printTime,
    projectTime,
    hours,
    material,
    energy,
    machine,
    maintenance,
    labor,
    other,
    total,
    priceMode,
    markup,
    price,
    profit,
    realMargin,
  };
}

function calculateOrderTotal(quantity, unitPrice, discount, freight = 0) {
  const qty = Math.max(1, Number.parseInt(quantity, 10) || 1);
  const gross = nonNegative(unitPrice) * qty;
  const disc = nonNegative(discount);
  const shipping = nonNegative(freight);
  if (disc > gross) {
    const error = new Error('Desconto não pode ser maior que o valor bruto do pedido.');
    error.status = 400;
    throw error;
  }
  return Math.max(0, gross - disc + shipping);
}

module.exports = { nonNegative, calculateQuoteCosts, calculateOrderTotal };
