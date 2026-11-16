"""Authoritative NSE Sector & Industry classification service.

Maps official NSE Indices CSV `Industry` classifications and symbol-verified NSE
Basic-Industry classifications into institutional Sector + granular Industry tiers
matching TradingView / NSE MES taxonomy without naive company-name guessing.
"""
from __future__ import annotations

# Maps official NSE CSV `Industry` -> TradingView-aligned institutional Sector label
NSE_MACRO_SECTOR_MAP: dict[str, str] = {
    "Financial Services": "Finance",
    "Information Technology": "Technology Services",
    "Oil Gas & Consumable Fuels": "Energy Minerals",
    "Oil, Gas & Consumable Fuels": "Energy Minerals",
    "Fast Moving Consumer Goods": "Consumer Non-Durables",
    "Automobile and Auto Components": "Consumer Durables",
    "Consumer Durables": "Consumer Durables",
    "Healthcare": "Health Technology",
    "Metals & Mining": "Non-Energy Minerals",
    "Telecommunication": "Communications",
    "Capital Goods": "Industrial Services",
    "Construction": "Industrial Services",
    "Construction Materials": "Non-Energy Minerals",
    "Power": "Utilities",
    "Utilities": "Utilities",
    "Services": "Transportation & Logistics",
    "Consumer Services": "Retail & Consumer Services",
    "Chemicals": "Process Industries",
    "Forest Materials": "Process Industries",
    "Textiles": "Process Industries",
    "Realty": "Real Estate",
    "Media Entertainment & Publication": "Media & Publishing",
    "Media, Entertainment & Publication": "Media & Publishing",
    "Diversified": "Diversified Industrials",
}

# Verified NSE Basic-Industry overrides for major index constituents so
# Group By -> Sector vs Group By -> Industry provides true 2-level granularity.
VERIFIED_BASIC_INDUSTRY: dict[str, tuple[str, str]] = {
    # Finance: Private Banks, PSU Banks, NBFCs, Insurance, Capital Markets
    "HDFCBANK": ("Finance", "Private Sector Bank"),
    "ICICIBANK": ("Finance", "Private Sector Bank"),
    "KOTAKBANK": ("Finance", "Private Sector Bank"),
    "AXISBANK": ("Finance", "Private Sector Bank"),
    "INDUSINDBK": ("Finance", "Private Sector Bank"),
    "FEDERALBNK": ("Finance", "Private Sector Bank"),
    "IDFCFIRSTB": ("Finance", "Private Sector Bank"),
    "BANDHANBNK": ("Finance", "Private Sector Bank"),
    "AUBANK": ("Finance", "Small Finance Bank"),
    "SBIN": ("Finance", "Public Sector Bank"),
    "BANKBARODA": ("Finance", "Public Sector Bank"),
    "PNB": ("Finance", "Public Sector Bank"),
    "CANBK": ("Finance", "Public Sector Bank"),
    "UNIONBANK": ("Finance", "Public Sector Bank"),
    "INDIANB": ("Finance", "Public Sector Bank"),
    "BANKINDIA": ("Finance", "Public Sector Bank"),
    "BAJFINANCE": ("Finance", "Non-Banking Financial Company (NBFC)"),
    "BAJAJFINSV": ("Finance", "Financial Holdings & NBFC"),
    "SHRIRAMFIN": ("Finance", "Non-Banking Financial Company (NBFC)"),
    "CHOLAFIN": ("Finance", "Non-Banking Financial Company (NBFC)"),
    "JIOFIN": ("Finance", "Non-Banking Financial Company (NBFC)"),
    "MUTHOOTFIN": ("Finance", "Gold & Retail Finance"),
    "PFC": ("Finance", "Power & Infrastructure Finance"),
    "RECLTD": ("Finance", "Power & Infrastructure Finance"),
    "IRFC": ("Finance", "Railway & Infrastructure Finance"),
    "SBILIFE": ("Finance", "Life Insurance"),
    "HDFCLIFE": ("Finance", "Life Insurance"),
    "ICICIPRULI": ("Finance", "Life Insurance"),
    "LICI": ("Finance", "Life Insurance"),
    "ICICIGI": ("Finance", "General Insurance"),
    "BSE": ("Finance", "Exchange & Capital Markets"),
    "MCX": ("Finance", "Exchange & Capital Markets"),
    "CDSL": ("Finance", "Depository & Market Infrastructure"),
    "ANGELONE": ("Finance", "Stockbroking & Wealth"),
    "360ONE": ("Finance", "Wealth & Asset Management"),
    "HDFCAMC": ("Finance", "Asset Management"),
    # Technology Services
    "TCS": ("Technology Services", "IT Consulting & Software"),
    "INFY": ("Technology Services", "IT Consulting & Software"),
    "HCLTECH": ("Technology Services", "IT Consulting & Software"),
    "WIPRO": ("Technology Services", "IT Consulting & Software"),
    "TECHM": ("Technology Services", "IT Consulting & Software"),
    "LTIM": ("Technology Services", "IT Consulting & Software"),
    "PERSISTENT": ("Technology Services", "Software & Digital Engineering"),
    "COFORGE": ("Technology Services", "Software & Digital Engineering"),
    "MPHASIS": ("Technology Services", "Software & Digital Engineering"),
    "OFSS": ("Technology Services", "Enterprise Financial Software"),
    "KPITTECH": ("Technology Services", "Automotive ER&D Software"),
    "TATAELXSI": ("Technology Services", "Embedded Design & ER&D"),
    # Energy Minerals
    "RELIANCE": ("Energy Minerals", "Refineries & Integrated Energy"),
    "ONGC": ("Energy Minerals", "Oil Exploration & Production"),
    "OIL": ("Energy Minerals", "Oil Exploration & Production"),
    "IOC": ("Energy Minerals", "Refineries & Oil Marketing"),
    "BPCL": ("Energy Minerals", "Refineries & Oil Marketing"),
    "HINDPETRO": ("Energy Minerals", "Refineries & Oil Marketing"),
    "COALINDIA": ("Energy Minerals", "Coal & Lignite Mining"),
    "GAIL": ("Utilities", "Gas Transmission & Marketing"),
    "PETRONET": ("Utilities", "LNG & Gas Distribution"),
    "IGL": ("Utilities", "City Gas Distribution"),
    # Utilities
    "NTPC": ("Utilities", "Electric Power Generation"),
    "POWERGRID": ("Utilities", "Electric Power Transmission"),
    "TATAPOWER": ("Utilities", "Integrated Power Utilities"),
    "ADANIPOWER": ("Utilities", "Thermal Power Generation"),
    "ADANIGREEN": ("Utilities", "Renewable Power Generation"),
    "JSWENERGY": ("Utilities", "Power Generation"),
    "NHPC": ("Utilities", "Hydroelectric Power"),
    # Consumer Durables & Automobiles
    "MARUTI": ("Consumer Durables", "Passenger Cars & Utility Vehicles"),
    "M&M": ("Consumer Durables", "Passenger Vehicles & Tractors"),
    "TATAMOTORS": ("Consumer Durables", "Passenger & Commercial Vehicles"),
    "TMPV": ("Consumer Durables", "Passenger & Commercial Vehicles"),
    "BAJAJ-AUTO": ("Consumer Durables", "2/3 Wheelers"),
    "EICHERMOT": ("Consumer Durables", "2 Wheelers & Commercial Vehicles"),
    "HEROMOTOCO": ("Consumer Durables", "2/3 Wheelers"),
    "TVSMOTOR": ("Consumer Durables", "2/3 Wheelers"),
    "ASHOKLEY": ("Industrial Services", "Commercial Vehicles"),
    "MOTHERSON": ("Consumer Durables", "Auto Components & Systems"),
    "BOSCHLTD": ("Consumer Durables", "Auto Components & Systems"),
    "BHARATFORG": ("Industrial Services", "Auto & Defense Forgings"),
    "TITAN": ("Consumer Durables", "Gems, Jewellery & Watches"),
    "KALYANKJIL": ("Consumer Durables", "Gems, Jewellery & Watches"),
    "HAVELLS": ("Consumer Durables", "Consumer Electricals"),
    "VOLTAS": ("Consumer Durables", "Air Conditioning & Appliances"),
    "DIXON": ("Electronic Technology", "Electronics Manufacturing (EMS)"),
    # Electronic Technology & Defense
    "BEL": ("Electronic Technology", "Aerospace & Defense Electronics"),
    "HAL": ("Electronic Technology", "Aerospace & Defense"),
    "BDL": ("Electronic Technology", "Defense Missiles & Systems"),
    "CGPOWER": ("Electronic Technology", "Heavy Electrical Equipment"),
    # Industrial Services & Capital Goods
    "LT": ("Industrial Services", "Engineering & Construction"),
    "SIEMENS": ("Industrial Services", "Heavy Electrical & Automation"),
    "ABB": ("Industrial Services", "Industrial Automation & Robotics"),
    "BHEL": ("Industrial Services", "Heavy Electrical Equipment"),
    "CUMMINSIND": ("Industrial Services", "Engines & Industrial Machinery"),
    "POLYCAB": ("Industrial Services", "Cables & Wires"),
    # Non-Energy Minerals (Metals & Cement)
    "TATASTEEL": ("Non-Energy Minerals", "Iron & Steel"),
    "JSWSTEEL": ("Non-Energy Minerals", "Iron & Steel"),
    "JINDALSTEL": ("Non-Energy Minerals", "Iron & Steel"),
    "SAIL": ("Non-Energy Minerals", "Iron & Steel"),
    "HINDALCO": ("Non-Energy Minerals", "Aluminium & Copper"),
    "VEDL": ("Non-Energy Minerals", "Diversified Metals & Mining"),
    "NMDC": ("Non-Energy Minerals", "Iron Ore & Minerals"),
    "ADANIENT": ("Distribution & Conglomerates", "Trading & Incubated Infrastructure"),
    "ULTRACEMCO": ("Non-Energy Minerals", "Cement & Cement Products"),
    "GRASIM": ("Non-Energy Minerals", "Cement & Viscose Staple Fibre"),
    "AMBUJACEM": ("Non-Energy Minerals", "Cement & Cement Products"),
    "SHREECEM": ("Non-Energy Minerals", "Cement & Cement Products"),
    # Consumer Non-Durables (FMCG)
    "HINDUNILVR": ("Consumer Non-Durables", "Personal & Household Products"),
    "ITC": ("Consumer Non-Durables", "Diversified FMCG & Cigarettes"),
    "NESTLEIND": ("Consumer Non-Durables", "Packaged Foods"),
    "BRITANNIA": ("Consumer Non-Durables", "Packaged Foods & Bakery"),
    "TATACONSUM": ("Consumer Non-Durables", "Tea, Coffee & Packaged Foods"),
    "DABUR": ("Consumer Non-Durables", "Personal Care & Ayurveda"),
    "MARICO": ("Consumer Non-Durables", "Edible Oils & Personal Care"),
    "GODREJCP": ("Consumer Non-Durables", "Personal & Household Care"),
    "COLPAL": ("Consumer Non-Durables", "Oral & Personal Care"),
    "VBL": ("Consumer Non-Durables", "Beverages & Bottling"),
    "UNITDSPR": ("Consumer Non-Durables", "Brewery & Distilleries"),
    # Process Industries (Paints & Chemicals)
    "ASIANPAINT": ("Process Industries", "Paints & Coatings"),
    "BERGEPAINT": ("Process Industries", "Paints & Coatings"),
    "PIDILITIND": ("Process Industries", "Specialty Chemicals & Adhesives"),
    "SRF": ("Process Industries", "Specialty Chemicals & Fluorochemicals"),
    "UPL": ("Process Industries", "Agrochemicals"),
    "PIIND": ("Process Industries", "Agrochemicals"),
    # Health Technology & Health Services
    "SUNPHARMA": ("Health Technology", "Pharmaceuticals"),
    "DRREDDY": ("Health Technology", "Pharmaceuticals"),
    "CIPLA": ("Health Technology", "Pharmaceuticals"),
    "DIVISLAB": ("Health Technology", "API & Custom Synthesis"),
    "LUPIN": ("Health Technology", "Pharmaceuticals"),
    "AUROPHARMA": ("Health Technology", "Pharmaceuticals"),
    "TORNTPHARM": ("Health Technology", "Pharmaceuticals"),
    "ZYDUSLIFE": ("Health Technology", "Pharmaceuticals"),
    "ALKEM": ("Health Technology", "Pharmaceuticals"),
    "BIOCON": ("Health Technology", "Biotechnology & Biosimilars"),
    "APOLLOHOSP": ("Health Services", "Hospitals & Healthcare Delivery"),
    "MAXHEALTH": ("Health Services", "Hospitals & Healthcare Delivery"),
    "FORTIS": ("Health Services", "Hospitals & Healthcare Delivery"),
    # Communications
    "BHARTIARTL": ("Communications", "Telecom Cellular & Fixed Line"),
    "INDUSTOWER": ("Communications", "Telecom Tower Infrastructure"),
    "IDEA": ("Communications", "Telecom Cellular Services"),
    "TATACOMM": ("Communications", "Enterprise Data & Telecom"),
    # Transportation & Logistics
    "ADANIPORTS": ("Transportation & Logistics", "Port & Marine Infrastructure"),
    "INDIGO": ("Transportation & Logistics", "Airlines & Aviation"),
    "CONCOR": ("Transportation & Logistics", "Container Rail Logistics"),
    "IRCTC": ("Transportation & Logistics", "Rail Ticketing & Catering"),
    # Retail & Consumer Services
    "TRENT": ("Retail & Consumer Services", "Apparel & Lifestyle Retail"),
    "DMART": ("Retail & Consumer Services", "Supermarkets & Hypermarkets"),
    "ETERNAL": ("Retail & Consumer Services", "Food Delivery & Quick Commerce"),
    "ZOMATO": ("Retail & Consumer Services", "Food Delivery & Quick Commerce"),
    "SWIGGY": ("Retail & Consumer Services", "Food Delivery & Quick Commerce"),
    "NAUKRI": ("Retail & Consumer Services", "Internet Classifieds & Portals"),
    "INDHOTEL": ("Retail & Consumer Services", "Hotels & Hospitality"),
    # Real Estate
    "DLF": ("Real Estate", "Residential & Commercial Projects"),
    "GODREJPROP": ("Real Estate", "Residential & Commercial Projects"),
    "MACROTECH": ("Real Estate", "Residential & Commercial Projects"),
    "OBEROIRLTY": ("Real Estate", "Residential & Commercial Projects"),
    "PHOENIXLTD": ("Real Estate", "Retail Malls & Commercial Realty"),
}


class SectorClassificationService:
    """Resolves verified Sector and granular Industry for NSE equities."""

    def __init__(self) -> None:
        self._dynamic_overrides: dict[str, tuple[str, str]] = {}

    def register_dynamic(self, symbol: str, sector: str | None, basic_industry: str | None) -> None:
        sym = (symbol or "").strip().upper()
        if not sym:
            return
        cur_sec, cur_ind = self.classify(sym, sector)
        new_sec = NSE_MACRO_SECTOR_MAP.get((sector or "").strip(), cur_sec)
        new_ind = (basic_industry or "").strip() or cur_ind
        self._dynamic_overrides[sym] = (new_sec, new_ind)

    def classify(self, symbol: str, nse_csv_industry: str | None = None) -> tuple[str, str]:
        sym = (symbol or "").strip().upper()
        if sym in self._dynamic_overrides:
            return self._dynamic_overrides[sym]
        if sym in VERIFIED_BASIC_INDUSTRY:
            return VERIFIED_BASIC_INDUSTRY[sym]
        raw_ind = (nse_csv_industry or "").strip()
        if raw_ind:
            sector = NSE_MACRO_SECTOR_MAP.get(raw_ind, raw_ind)
            return (sector, raw_ind)
        return ("Unclassified", "Unclassified")
