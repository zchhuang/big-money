import type { Currency, Money } from './models';

export function validateCurrency(currency: Currency) {
  if (
    !/^[A-Z][A-Z0-9._-]{2,11}$/.test(currency.code) ||
    !Number.isInteger(currency.scale) ||
    currency.scale < 0 ||
    currency.scale > 12
  ) {
    throw new Error('invalid-financial-currency');
  }
}
export function validateMoney(money: Money) {
  validateCurrency(money);
  if (!/^(0|-?[1-9]\d*)$/.test(money.minor) || money.minor.length > 80) {
    throw new Error('invalid-financial-amount');
  }
}
export function decimalToMoney(decimal: string, currency: Currency): Money {
  validateCurrency(currency);
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(decimal);
  if (!match || decimal.length > 80) {
    throw new Error('invalid-financial-decimal');
  }
  const fraction = match[3] ?? '';
  if (fraction.slice(currency.scale).replace(/0/g, '').length) {
    throw new Error('financial-precision-loss');
  }
  const magnitude = BigInt(
    match[2] + fraction.slice(0, currency.scale).padEnd(currency.scale, '0'),
  );
  return { ...currency, minor: (match[1] ? -magnitude : magnitude).toString() };
}
export function actualAmount(money: Money): number {
  validateMoney(money);
  let value = BigInt(money.minor);
  if (money.scale <= 2) {
    value *= 10n ** BigInt(2 - money.scale);
  } else {
    const divisor = 10n ** BigInt(money.scale - 2);
    if (value % divisor !== 0n) throw new Error('financial-precision-loss');
    value /= divisor;
  }
  if (
    value > BigInt(Number.MAX_SAFE_INTEGER) ||
    value < BigInt(Number.MIN_SAFE_INTEGER)
  ) {
    throw new Error('financial-amount-overflow');
  }
  return Number(value);
}
