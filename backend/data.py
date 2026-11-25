"""Static data for the Riga / Latvia demo: places, vehicle types, prices."""
import random

# Real Latvian freight locations (approximate coordinates).
LOCATIONS = {
    "RIGA_DEPOT":   ("FleetMind Depot, Granita iela (Riga)", 56.917, 24.228),
    "FREEPORT":     ("Freeport of Riga", 56.990, 24.070),
    "RIX_CARGO":    ("Riga Airport Cargo", 56.923, 23.971),
    "SALASPILS":    ("Salaspils industrial park", 56.861, 24.349),
    "KEKAVA":       ("Kekava logistics centre", 56.828, 24.230),
    "OLAINE":       ("Olaine chemical plant", 56.785, 23.938),
    "MARUPE":       ("Marupe warehouses", 56.906, 23.982),
    "ADAZI":        ("Adazi distribution hub", 57.075, 24.322),
    "JURMALA":      ("Jurmala", 56.968, 23.770),
    "JELGAVA":      ("Jelgava hub", 56.651, 23.721),
    "OGRE":         ("Ogre", 56.816, 24.604),
    "SIGULDA":      ("Sigulda", 57.154, 24.853),
    "CESIS":        ("Cesis", 57.312, 25.270),
    "VALMIERA":     ("Valmiera glass fibre plant", 57.541, 25.427),
    "TUKUMS":       ("Tukums", 56.967, 23.155),
    "DOBELE":       ("Dobele", 56.625, 23.278),
    "BAUSKA":       ("Bauska", 56.408, 24.193),
    "AIZKRAUKLE":   ("Aizkraukle", 56.604, 25.255),
    "JEKABPILS":    ("Jekabpils", 56.499, 25.857),
    "DAUGAVPILS":   ("Daugavpils", 55.875, 26.536),
    "REZEKNE":      ("Rezekne", 56.510, 27.333),
    "LIEPAJA":      ("Port of Liepaja", 56.530, 21.010),
    "VENTSPILS":    ("Port of Ventspils", 57.395, 21.560),
    "LIMBAZI":      ("Limbazi", 57.513, 24.713),
    "SAULKRASTI":   ("Saulkrasti", 57.264, 24.414),
}

DEPOTS = ["RIGA_DEPOT", "FREEPORT", "JELGAVA"]

# Busy origins get picked more often for freight pickups.
PICKUP_WEIGHTS = {"FREEPORT": 5, "RIX_CARGO": 3, "RIGA_DEPOT": 3, "SALASPILS": 3,
                  "KEKAVA": 2, "MARUPE": 2, "OLAINE": 2, "VENTSPILS": 2, "LIEPAJA": 2}

VEHICLE_TYPES = {
    # capacity kg, consumption per km, tank/battery size, energy unit, service interval km, base speed km/h
    "truck_diesel": dict(label="Diesel truck", capacity=20000, use_per_km=0.32, tank=600, unit="L",
                         service_km=40000, speed=72, energy="diesel"),
    "van_diesel":   dict(label="Diesel van", capacity=1500, use_per_km=0.09, tank=80, unit="L",
                         service_km=30000, speed=80, energy="diesel"),
    "truck_ev":     dict(label="Electric truck", capacity=16000, use_per_km=1.30, tank=500, unit="kWh",
                         service_km=50000, speed=70, energy="electric"),
    "van_ev":       dict(label="Electric van", capacity=1000, use_per_km=0.25, tank=75, unit="kWh",
                         service_km=50000, speed=78, energy="electric"),
}

FLEET_MIX = [("truck_diesel", 14), ("van_diesel", 8), ("truck_ev", 3), ("van_ev", 5)]

# Prices. Diesel = Latvian national average, EU Weekly Oil Bulletin, 9 Nov 2026.
PRICES = {
    "diesel_eur_l": 2.08,
    "petrol_eur_l": 1.85,
    "electricity_eur_kwh": 0.40,   # estimate: depot + public charging mix
    "late_penalty_eur": 150,
    "tow_eur": 280,
    "driver_eur_h": 14,
    "source": "EU Weekly Oil Bulletin, Latvia national average, 9 Nov 2026 (electricity is an estimate)",
}
CO2 = {"diesel_kg_l": 2.68, "electric_kg_kwh": 0.10}

DRIVER_NAMES = ["Janis Ozols", "Andris Berzins", "Maris Kalnins", "Edgars Liepa", "Raivis Krumins",
                "Kristaps Zarins", "Arturs Vitols", "Toms Eglitis", "Martins Lacis", "Ilze Kalnina",
                "Laura Ozolina", "Roberts Sproģis", "Davis Rozitis", "Aivars Balodis", "Gints Pumpurs",
                "Inga Berzina", "Uldis Celmins", "Valdis Jansons", "Karlis Strods", "Liga Petersone",
                "Normunds Vilks", "Rihards Briedis", "Oskars Akmens", "Elina Zvaigzne", "Juris Rudzitis",
                "Sandis Kalejs", "Agris Dumins", "Viktors Ivanovs", "Sergejs Petrovs", "Dace Lapina"]

CARGO = ["timber", "pallets of groceries", "steel coils", "fertiliser bags", "containers",
         "furniture", "electronics", "building materials", "glass fibre rolls", "frozen food",
         "paper rolls", "medical supplies", "auto parts", "beverages"]


def loc(key):
    name, lat, lon = LOCATIONS[key]
    return {"key": key, "name": name, "lat": lat, "lon": lon}


def random_pickup(rng: random.Random):
    keys = list(LOCATIONS)
    weights = [PICKUP_WEIGHTS.get(k, 1) for k in keys]
    return rng.choices(keys, weights)[0]
