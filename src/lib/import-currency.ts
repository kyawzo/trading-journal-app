type CurrencyValidationResult =
  | { ok: true }
  | { ok: false; message: string };

export function validateImportCurrencyMatch(input: {
  brokerAccountCurrency: string | null | undefined;
  detectedCurrencies: string[] | null | undefined;
}) : CurrencyValidationResult {
  const brokerCurrency = (input.brokerAccountCurrency ?? "").trim().toUpperCase();
  const currencies = (input.detectedCurrencies ?? [])
    .map((value) => value.trim().toUpperCase())
    .filter((value) => value.length > 0);

  if (!brokerCurrency) {
    return {
      ok: false,
      message: "Selected broker account has no base currency configured.",
    };
  }

  if (currencies.length === 0) {
    return {
      ok: false,
      message: "CSV currency could not be detected. Ensure the CSV includes a Currency column with values like USD or SGD.",
    };
  }

  const uniqueCurrencies = [...new Set(currencies)];
  if (uniqueCurrencies.length > 1) {
    return {
      ok: false,
      message: `CSV contains multiple currencies (${uniqueCurrencies.join(", ")}). Import one currency per broker account.`,
    };
  }

  if (uniqueCurrencies[0] !== brokerCurrency) {
    return {
      ok: false,
      message: `Currency mismatch: broker account is ${brokerCurrency}, but CSV is ${uniqueCurrencies[0]}.`,
    };
  }

  return { ok: true };
}
