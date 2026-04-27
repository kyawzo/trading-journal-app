import { LegSide, LegStatus, LegType, OptionType } from "@prisma/client";
import { NextResponse } from "next/server";
import { getCurrentUser, redirectToLoginResponse } from "../../../../../lib/auth";
import {
  getPositionStrategyLegTemplate,
  validateStructuredStrikeOrder,
} from "../../../../../lib/position-leg-templates";
import { findOwnedPositionForUser } from "../../../../../lib/ownership";
import { calculateCoveredCallShareUsage, parseNumericInput, toNumber } from "../../../../../lib/position-rules";
import { prisma } from "../../../../../lib/prisma";

type RouteProps = {
    params: Promise<{ id: string }>;
};

function redirectWithMessage(req: Request, id: string, tone: "success" | "error", message: string) {
    const url = new URL(`/positions/${id}`, req.url);
    url.searchParams.set("tone", tone);
    url.searchParams.set("notice", message);
    return NextResponse.redirect(url);
}

function jsonErrorResponse(message: string, status: number = 400) {
    return NextResponse.json({ error: message }, { status });
}

function requirePositiveNumber(value: number | null, message: string) {
    return value !== null && value > 0 ? null : message;
}

export async function POST(req: Request, { params }: RouteProps) {
    const { id } = await params;
    const user = await getCurrentUser();

    if (!user) {
        return redirectToLoginResponse(req, `/positions/${id}`);
    }

    const form = await req.formData();

    const position = await findOwnedPositionForUser(user.id, id, {
        linkedHolding: true,
        legs: true,
    });

    if (!position) {
        return redirectWithMessage(req, id, "error", "Position not found.");
    }

    const template = getPositionStrategyLegTemplate(position.strategyType);

    if (template) {
        if (position.legs.length > 0) {
            return jsonErrorResponse(`${template.label} already has generated legs. Use Manage Leg to adjust the existing structure.`);
        }

        const quantityRaw = ((form.get("quantity") as string) || "").trim();
        const multiplierRaw = ((form.get("multiplier") as string) || (template.mode === "single-stock" ? "1" : "100")).trim();
        const expiryDateRaw = (form.get("expiryDate") as string | null)?.trim() || null;

        const quantity = parseNumericInput(quantityRaw);
        const multiplier = parseNumericInput(multiplierRaw);

        const quantityError = requirePositiveNumber(quantity, "Quantity must be greater than zero.");
        if (quantityError) {
            return jsonErrorResponse(quantityError);
        }

        const multiplierError = requirePositiveNumber(multiplier, "Multiplier must be greater than zero.");
        if (multiplierError) {
            return jsonErrorResponse(multiplierError);
        }

        if (template.mode !== "single-stock" && !expiryDateRaw) {
            return jsonErrorResponse("Expiry date is required for option strategies.");
        }

        const strikeFields = {
            singleStrike: parseNumericInput((form.get("singleStrike") as string | null)?.trim() || null),
            shortStrike: parseNumericInput((form.get("shortStrike") as string | null)?.trim() || null),
            longStrike: parseNumericInput((form.get("longStrike") as string | null)?.trim() || null),
            longPutStrike: parseNumericInput((form.get("longPutStrike") as string | null)?.trim() || null),
            shortPutStrike: parseNumericInput((form.get("shortPutStrike") as string | null)?.trim() || null),
            shortCallStrike: parseNumericInput((form.get("shortCallStrike") as string | null)?.trim() || null),
            longCallStrike: parseNumericInput((form.get("longCallStrike") as string | null)?.trim() || null),
        };

        for (const leg of template.legs) {
            if (!leg.strikeField) {
                continue;
            }

            const strikeValue = strikeFields[leg.strikeField];
            if (strikeValue === null || strikeValue <= 0) {
                return jsonErrorResponse(`${leg.label} requires a valid positive strike price.`);
            }
        }

        const strikeOrderError = validateStructuredStrikeOrder(position.strategyType, {
            singleStrike: strikeFields.singleStrike ?? undefined,
            shortStrike: strikeFields.shortStrike ?? undefined,
            longStrike: strikeFields.longStrike ?? undefined,
            longPutStrike: strikeFields.longPutStrike ?? undefined,
            shortPutStrike: strikeFields.shortPutStrike ?? undefined,
            shortCallStrike: strikeFields.shortCallStrike ?? undefined,
            longCallStrike: strikeFields.longCallStrike ?? undefined,
        });

        if (strikeOrderError) {
            return jsonErrorResponse(strikeOrderError);
        }

        const createdLegs = template.legs.map((leg) => ({
            positionId: id,
            legType: leg.legType as LegType,
            legSide: leg.legSide as LegSide,
            optionType: leg.legType === "OPTION" ? (leg.optionType as OptionType) : null,
            underlyingSymbol: position.underlyingSymbol,
            expiryDate: leg.legType === "OPTION" && expiryDateRaw ? new Date(expiryDateRaw) : null,
            strikePrice: leg.strikeField ? String(strikeFields[leg.strikeField]) : null,
            quantity: quantityRaw,
            multiplier: multiplierRaw,
            legRole: leg.legRole,
            openedAt: new Date(),
            legStatus: "OPEN" as LegStatus,
        }));

        const coveredCallSharesRequested =
            position.strategyType === "CC"
                ? createdLegs.reduce((total, leg) => {
                    if (leg.legType === "OPTION" && leg.legSide === "SHORT" && leg.optionType === "CALL") {
                        return total + (quantity ?? 0) * (multiplier ?? 0);
                    }
                    return total;
                }, 0)
                : 0;

        if (coveredCallSharesRequested > 0) {
            if (!position.linkedHolding) {
                return jsonErrorResponse("Covered call positions require a linked holding before adding a short call leg.");
            }

            const remainingShares = toNumber(position.linkedHolding.remainingQuantity);
            const existingCoverage = calculateCoveredCallShareUsage(position.legs);

            if (existingCoverage + coveredCallSharesRequested > remainingShares) {
                return jsonErrorResponse(
                    `This covered call structure needs ${coveredCallSharesRequested} shares, but only ${remainingShares} linked shares are available.`
                );
            }
        }

        await prisma.$transaction(createdLegs.map((leg) => prisma.positionLeg.create({ data: leg })));

        return NextResponse.json({ success: true });
    }

    const legType = ((form.get("legType") as string) || "").trim();
    const legSide = ((form.get("legSide") as string) || "").trim();
    const optionTypeRaw = (form.get("optionType") as string | null)?.trim() || null;
    const strikePriceRaw = (form.get("strikePrice") as string | null)?.trim() || null;
    const quantityRaw = ((form.get("quantity") as string) || "").trim();
    const multiplierRaw = ((form.get("multiplier") as string) || "1").trim();
    const expiryDateRaw = (form.get("expiryDate") as string | null)?.trim() || null;
    const legRole = (form.get("legRole") as string | null)?.trim() || null;

    const quantity = parseNumericInput(quantityRaw);
    const multiplier = parseNumericInput(multiplierRaw);
    const strikePrice = parseNumericInput(strikePriceRaw);

    if (!legType || !legSide || !quantityRaw) {
        return jsonErrorResponse("Leg type, leg side, and quantity are required.");
    }

    if (quantity === null || quantity <= 0) {
        return jsonErrorResponse("Quantity must be greater than zero.");
    }

    if (multiplier === null || multiplier <= 0) {
        return jsonErrorResponse("Multiplier must be greater than zero.");
    }

    if (legType === "OPTION") {
        if (!optionTypeRaw || !strikePriceRaw || !expiryDateRaw) {
            return jsonErrorResponse("Option legs require option type, strike price, and expiry date.");
        }

        if (strikePrice === null || strikePrice <= 0) {
            return jsonErrorResponse("Strike price must be greater than zero.");
        }
    }

    if (position.strategyType === "CC" && legType === "OPTION" && legSide === "SHORT" && optionTypeRaw === "CALL") {
        if (!position.linkedHolding) {
            return jsonErrorResponse("Covered call positions require a linked holding before adding a short call leg.");
        }

        const remainingShares = toNumber(position.linkedHolding.remainingQuantity);
        const existingCoverage = calculateCoveredCallShareUsage(position.legs);
        const requestedCoverage = quantity * multiplier;

        if (existingCoverage + requestedCoverage > remainingShares) {
            return jsonErrorResponse(
                `This covered call leg needs ${requestedCoverage} shares, but only ${remainingShares} linked shares are available.`
            );
        }
    }

    await prisma.positionLeg.create({
        data: {
            positionId: id,
            legType: legType as LegType,
            legSide: legSide as LegSide,
            optionType: legType === "OPTION" ? (optionTypeRaw as OptionType) : null,
            underlyingSymbol: position.underlyingSymbol,
            expiryDate: legType === "OPTION" && expiryDateRaw ? new Date(expiryDateRaw) : null,
            strikePrice: legType === "OPTION" ? strikePriceRaw : null,
            quantity: quantityRaw,
            multiplier: multiplierRaw || "1",
            legRole,
            openedAt: new Date(),
            legStatus: "OPEN" as LegStatus,
        },
    });

    return NextResponse.json({ success: true });
}

