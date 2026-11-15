"""Pydantic request schemas. Units are explicit in every field name:
*_pct  = percent (4.25 means 4.25%), *_bp = basis points (1bp = 0.01%)."""
from __future__ import annotations

from datetime import date as Date
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from app.data.sources import TENORS

DayCountName = Literal["ACT/ACT-ICMA", "30/360", "ACT/360", "ACT/365F"]
Tenor = Literal["1M", "3M", "6M", "1Y", "2Y", "3Y", "5Y", "7Y", "10Y", "20Y", "30Y"]


class PositionIn(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    label: str = Field(min_length=1, max_length=120)
    coupon_pct: float = Field(ge=0, le=25, description="Annual coupon rate in percent")
    maturity: Date
    face_amount: float = Field(gt=0, le=1e11, description="Face amount in USD")
    frequency: Literal[1, 2, 4, 12] = 2
    day_count: DayCountName = "ACT/ACT-ICMA"


class CurveSpec(BaseModel):
    date: Date | None = Field(None, description="Use the Treasury curve on/before this date; latest if omitted")
    custom_par_pct: dict[Tenor, float] | None = Field(
        None, description="Override with a user-supplied par curve (percent by tenor)"
    )

    @field_validator("custom_par_pct")
    @classmethod
    def _range(cls, v):
        if v is not None:
            if len(v) < 2:
                raise ValueError("custom curve needs at least two tenors")
            for t, y in v.items():
                if not -5 <= y <= 30:
                    raise ValueError(f"{t}: yield {y}% outside [-5%, 30%]")
        return v


class PortfolioRequest(BaseModel):
    positions: list[PositionIn] = Field(min_length=1, max_length=200)
    curve: CurveSpec = CurveSpec()
    settlement: Date | None = None


class ScenarioRequest(PortfolioRequest):
    shocks_bp: dict[Tenor, float] = Field(default_factory=dict)

    @field_validator("shocks_bp")
    @classmethod
    def _bounds(cls, v):
        for t, s in v.items():
            if abs(s) > 1000:
                raise ValueError(f"{t}: shock {s}bp exceeds +/-1000bp")
        return v


class CompareRequest(BaseModel):
    a: list[PositionIn] = Field(min_length=1, max_length=200)
    b: list[PositionIn] = Field(min_length=1, max_length=200)
    name_a: str = "Portfolio A"
    name_b: str = "Portfolio B"
    curve: CurveSpec = CurveSpec()
    shocks_bp: dict[Tenor, float] = Field(default_factory=dict)


class ShapeRequest(BaseModel):
    kind: Literal["parallel", "preset", "anchors", "custom"]
    bp: float = 0.0
    preset: str | None = None
    scale: float = 1.0
    anchors: dict[Tenor, float] | None = None
    custom: dict[Tenor, float] | None = None


class BondRequest(BaseModel):
    maturity: Date
    coupon_pct: float = Field(ge=0, le=25)
    frequency: Literal[1, 2, 4, 12] = 2
    day_count: DayCountName = "ACT/ACT-ICMA"
    settlement: Date
    mode: Literal["yield", "price", "curve"] = "yield"
    ytm_pct: float | None = Field(None, ge=-5, le=50)
    clean_price: float | None = Field(None, gt=0, le=1000)
    curve: CurveSpec = CurveSpec()
    face_amount: float = Field(1_000_000, gt=0)
    shocks_bp: list[float] = Field(default_factory=lambda: [-300, -200, -100, -50, -25, 25, 50, 100, 200, 300])

    @model_validator(mode="after")
    def _need_input(self):
        if self.maturity <= self.settlement:
            raise ValueError("maturity must be after settlement")
        if self.mode == "yield" and self.ytm_pct is None:
            raise ValueError("ytm_pct required when mode='yield'")
        if self.mode == "price" and self.clean_price is None:
            raise ValueError("clean_price required when mode='price'")
        return self


class HorizonRequest(BaseModel):
    maturity: Date
    coupon_pct: float = Field(ge=0, le=25)
    frequency: Literal[1, 2, 4, 12] = 2
    day_count: DayCountName = "ACT/ACT-ICMA"
    settlement: Date
    horizon_date: Date
    ytm_start_pct: float = Field(ge=-5, le=50)
    ytm_end_pct: float = Field(ge=-5, le=50)
    reinvest_pct: float | None = Field(None, ge=-5, le=50)


class CashFlowIn(BaseModel):
    date: Date
    amount: float


class CustomCashFlowRequest(BaseModel):
    settlement: Date
    flows: list[CashFlowIn] = Field(min_length=1, max_length=2000)
    compounding: Literal["1", "2", "4", "12", "continuous"] = "2"
    mode: Literal["yield", "price", "curve"] = "yield"
    ytm_pct: float | None = Field(None, ge=-5, le=50)
    price: float | None = Field(None, gt=0)
    curve: CurveSpec = CurveSpec()


class SpotCurveRequest(BaseModel):
    years: list[float] = Field(min_length=2)
    rates_pct: list[float] = Field(min_length=2)
    compounding: Literal["1", "2", "4", "12", "continuous"] = "2"

    @model_validator(mode="after")
    def _len(self):
        if len(self.years) != len(self.rates_pct):
            raise ValueError("years and rates_pct must have equal length")
        return self


class PolicyParams(BaseModel):
    policy_move_bp: float = Field(ge=-500, le=500)
    interpretation: str = "expected"
    priced_in: float | None = Field(None, ge=0, le=1)
    path_bp: float | None = Field(None, ge=-300, le=300)
    term_premium_bp: float | None = Field(None, ge=-300, le=300)
    transmission: str = "front_end"
    pass_through: dict[Tenor, float] | None = None
    overlay_kind: Literal["none", "parallel", "steepening", "flattening", "twist"] = "none"
    overlay_bp: float = Field(0.0, ge=-300, le=300)
    overlay_pivot: Tenor = "5Y"

    @field_validator("pass_through")
    @classmethod
    def _pt(cls, v):
        if v is not None:
            for t, b in v.items():
                if not -2 <= b <= 2:
                    raise ValueError(f"pass-through for {t} must be in [-2, 2]")
        return v


class PolicyRequest(PolicyParams):
    positions: list[PositionIn] = Field(min_length=1, max_length=200)
    curve: CurveSpec = CurveSpec()


class HistoryApplyRequest(BaseModel):
    event_id: str | None = None
    start: Date | None = None
    end: Date | None = None
    portfolios: dict[str, list[PositionIn]] = Field(default_factory=dict)
    include_samples: bool = True
    curve: CurveSpec = CurveSpec()


class OptimizeRequest(BaseModel):
    objective: Literal["min_concentration", "match_krd", "risk_target", "max_yield"]
    capital: float = Field(100_000_000, gt=0, le=1e12)
    target_duration: float | None = Field(None, gt=0, le=30)
    max_weight: float = Field(0.4, gt=0, le=1)
    max_bucket_weight: float | None = Field(None, gt=0, le=1)
    long_only: bool = True
    universe_years: list[int] | None = None
    universe_positions: list[PositionIn] | None = None
    benchmark_positions: list[PositionIn] | None = None
    target_krd: dict[Tenor, float] | None = None
    krd_weights: dict[Tenor, float] | None = None
    curve: CurveSpec = CurveSpec()

    @field_validator("universe_years")
    @classmethod
    def _yrs(cls, v):
        if v is not None:
            if not 2 <= len(v) <= 30 or any(y < 1 or y > 30 for y in v):
                raise ValueError("universe_years: 2-30 maturities, each 1-30 years")
        return v


class BarbellBulletRequest(BaseModel):
    target_years: int = Field(10, ge=2, le=29)
    short_years: int = Field(2, ge=1, le=29)
    long_years: int = Field(30, ge=2, le=30)
    notional: float = Field(100_000_000, gt=0)
    curve: CurveSpec = CurveSpec()


class ReportRequest(BaseModel):
    positions: list[PositionIn] = Field(min_length=1, max_length=200)
    portfolio_name: str = "Portfolio"
    curve: CurveSpec = CurveSpec()
    scenario_label: str = "Custom curve scenario"
    shocks_bp: dict[Tenor, float] | None = None
    policy: PolicyParams | None = None


def all_tenors() -> list[str]:
    return list(TENORS)
