/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import i18n from "@/i18n/config";
import { normalizeInterfaceLanguage, toIntlLocale } from "@/i18n/languages";
import {
  formatBillingCurrencyFromUSD,
  formatCurrencyFromUSD,
  getCurrencyDisplay,
  type CurrencyFormatOptions,
} from "@/lib/currency";

export const CHINESE_MODEL_PRICE_EXCHANGE_RATE = 6.8;

export function isChineseModelPricingLanguage(language?: string): boolean {
  const normalizedLanguage = normalizeInterfaceLanguage(
    language || i18n.resolvedLanguage || i18n.language,
  );
  return normalizedLanguage === "zhCN" || normalizedLanguage === "zhTW";
}

export function getModelPricingCurrencyDisplay(language?: string): {
  symbol: string;
  currencyCode?: string;
  exchangeRate: number;
} {
  if (isChineseModelPricingLanguage(language)) {
    return {
      symbol: "¥",
      currencyCode: "CNY",
      exchangeRate: CHINESE_MODEL_PRICE_EXCHANGE_RATE,
    };
  }

  const { meta } = getCurrencyDisplay();
  if (meta.kind === "currency") {
    return {
      symbol: meta.symbol,
      currencyCode: meta.currencyCode,
      exchangeRate: meta.exchangeRate,
    };
  }
  if (meta.kind === "custom") {
    return {
      symbol: meta.symbol,
      exchangeRate: meta.exchangeRate,
    };
  }
  return { symbol: "$", currencyCode: "USD", exchangeRate: 1 };
}

function formatChineseModelPrice(
  amountUSD: number | null | undefined,
  options?: CurrencyFormatOptions,
): string {
  if (amountUSD == null || Number.isNaN(amountUSD)) return "-";

  const value = amountUSD * CHINESE_MODEL_PRICE_EXCHANGE_RATE;
  const digits =
    Math.abs(value) >= 1
      ? (options?.digitsLarge ?? 2)
      : (options?.digitsSmall ?? 4);
  const minimumNonZero = options?.minimumNonZero ?? Math.pow(10, -digits);
  const adjustedValue =
    value !== 0 && Math.abs(value) < minimumNonZero
      ? Math.sign(value) * minimumNonZero
      : value;

  return new Intl.NumberFormat(
    toIntlLocale(i18n.resolvedLanguage || i18n.language),
    {
      style: "currency",
      currency: "CNY",
      currencyDisplay: "narrowSymbol",
      minimumFractionDigits: 0,
      maximumFractionDigits: digits,
    },
  ).format(adjustedValue);
}

export function formatModelPricingCurrencyFromUSD(
  amountUSD: number | null | undefined,
  options?: CurrencyFormatOptions,
): string {
  return isChineseModelPricingLanguage()
    ? formatChineseModelPrice(amountUSD, options)
    : formatCurrencyFromUSD(amountUSD, options);
}

export function formatModelPricingBillingCurrencyFromUSD(
  amountUSD: number | null | undefined,
  options?: CurrencyFormatOptions,
): string {
  return isChineseModelPricingLanguage()
    ? formatChineseModelPrice(amountUSD, options)
    : formatBillingCurrencyFromUSD(amountUSD, options);
}
