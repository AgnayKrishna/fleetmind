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

# Truck routing dimensions per type (typical EU values): height / width / length in m,
# max gross weight and empty weight in kg, axle count. Diesel truck = 5-axle tractor + semi-trailer,
# electric truck = 3-axle rigid, vans = 3.5 t panel vans.
VEHICLE_DIMENSIONS = {
    "truck_diesel": dict(height_m=4.0, width_m=2.55, length_m=16.5, weight_kg=40000, empty_kg=15000, axles=5),
    "van_diesel":   dict(height_m=2.7, width_m=2.05, length_m=6.0, weight_kg=3500, empty_kg=2000, axles=2),
    "truck_ev":     dict(height_m=3.9, width_m=2.55, length_m=12.0, weight_kg=27000, empty_kg=11000, axles=3),
    "van_ev":       dict(height_m=2.6, width_m=2.0, length_m=5.5, weight_kg=3500, empty_kg=2500, axles=2),
}
HAZMAT_CARGO = {"fertiliser bags"}      # ammonium-nitrate fertiliser can be ADR class 5.1: hazmat routing

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

# Demo fuel stations and chargers along the main Latvian freight roads. Locations are approximate
# and prices are estimates around the national average above, so the Fuel & Cost Agent (Leo) has a
# realistic spread to choose from. (id, name, lat, lon, diesel EUR/L)
FUEL_STATIONS = [
    ("F01", "Circle K Jugla, Riga", 56.983, 24.233, 1.99),
    ("F02", "Neste Brivibas iela, Riga", 56.970, 24.160, 2.08),
    ("F03", "Circle K Milgravis, Riga", 57.010, 24.090, 2.09),
    ("F04", "Viada Marupe", 56.905, 24.000, 2.04),
    ("F05", "Virsi Kekava", 56.835, 24.225, 2.02),
    ("F06", "Viada Salaspils", 56.865, 24.340, 2.03),
    ("F07", "Circle K Olaine", 56.790, 23.945, 2.05),
    ("F08", "Neste Jelgava", 56.655, 23.735, 2.01),
    ("F09", "Virsi Ogre", 56.820, 24.590, 2.04),
    ("F10", "Circle K Sigulda", 57.150, 24.840, 2.07),
    ("F11", "Virsi Cesis", 57.305, 25.260, 2.06),
    ("F12", "Neste Valmiera", 57.535, 25.410, 2.03),
    ("F13", "Virsi Tukums", 56.965, 23.170, 2.00),
    ("F14", "Virsi Dobele", 56.625, 23.290, 2.02),
    ("F15", "Circle K Bauska", 56.410, 24.200, 2.06),
    ("F16", "Neste Aizkraukle", 56.605, 25.240, 2.05),
    ("F17", "Viada Jekabpils", 56.500, 25.850, 2.02),
    ("F18", "Neste Daugavpils", 55.880, 26.520, 1.98),
    ("F19", "Circle K Rezekne", 56.505, 27.320, 2.04),
    ("F20", "Virsi Liepaja", 56.520, 21.020, 2.01),
    ("F21", "Neste Ventspils", 57.390, 21.580, 2.03),
    ("F22", "Circle K Adazi", 57.070, 24.320, 2.05),
    ("F23", "Circle K Limbazi", 57.510, 24.700, 2.06),
    ("F24", "Neste Saulkrasti", 57.260, 24.420, 2.04),
]

# (id, name, lat, lon, charger kW, EUR/kWh)
CHARGERS = [
    ("C01", "FleetMind depot chargers, Granita iela", 56.917, 24.228, 150, 0.30),
    ("C02", "Ignitis ON Jugla, Riga", 56.983, 24.236, 150, 0.45),
    ("C03", "Elektrum Lielirbes iela, Riga", 56.930, 24.035, 150, 0.42),
    ("C04", "Ignitis ON Freeport, Riga", 56.995, 24.080, 150, 0.45),
    ("C05", "Ignitis ON Kekava", 56.830, 24.225, 150, 0.45),
    ("C06", "Elektrum Jelgava", 56.651, 23.725, 50, 0.42),
    ("C07", "Ignitis ON Jurmala", 56.968, 23.790, 150, 0.45),
    ("C08", "Elektrum Ogre", 56.818, 24.600, 50, 0.42),
    ("C09", "Elektrum Sigulda", 57.152, 24.850, 50, 0.42),
    ("C10", "Ignitis ON Valmiera", 57.538, 25.420, 150, 0.45),
    ("C11", "Elektrum Tukums", 56.967, 23.160, 50, 0.42),
    ("C12", "Elektrum Jekabpils", 56.500, 25.860, 50, 0.42),
    ("C13", "Elektrum Daugavpils", 55.875, 26.530, 50, 0.42),
    ("C14", "Elektrum Liepaja", 56.525, 21.015, 50, 0.42),
    ("C15", "Elektrum Ventspils", 57.392, 21.570, 50, 0.42),
    ("C16", "Ignitis ON Bauska", 56.408, 24.190, 150, 0.45),
]

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
