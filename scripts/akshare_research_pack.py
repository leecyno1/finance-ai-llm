#!/usr/bin/env python3
import json
import sys


def main():
    query = sys.argv[1] if len(sys.argv) > 1 else ""
    ts_code = sys.argv[2] if len(sys.argv) > 2 else ""
    out = {
        "query": query,
        "tsCode": ts_code,
        "sources": [],
        "warnings": [],
        "spot": None,
        "financialIndicators": [],
    }

    try:
        import akshare as ak  # type: ignore
    except Exception as exc:
        out["warnings"].append(f"akshare unavailable: {exc}")
        print(json.dumps(out, ensure_ascii=False))
        return

    symbol = ts_code.split(".")[0] if ts_code else ""
    try:
        if symbol:
            spot_df = ak.stock_zh_a_spot_em()
            if "代码" in spot_df.columns:
                row = spot_df[spot_df["代码"].astype(str) == symbol]
                if not row.empty:
                    out["spot"] = row.head(1).to_dict(orient="records")[0]
                    out["sources"].append("akshare.stock_zh_a_spot_em")
    except Exception as exc:
        out["warnings"].append(f"stock_zh_a_spot_em: {exc}")

    try:
        if symbol:
            indicator_df = ak.stock_financial_analysis_indicator(symbol=symbol)
            out["financialIndicators"] = indicator_df.head(4).to_dict(orient="records")
            out["sources"].append("akshare.stock_financial_analysis_indicator")
    except Exception as exc:
        out["warnings"].append(f"stock_financial_analysis_indicator: {exc}")

    print(json.dumps(out, ensure_ascii=False, default=str))


if __name__ == "__main__":
    main()
