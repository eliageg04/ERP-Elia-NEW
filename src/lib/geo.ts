// ============================================================
// Geodaten für die Kunden-Weltkarte: Städte-/Länderkoordinaten,
// US-Bundesstaat-Erkennung und Versandtage-Zonen (UPS).
// Regeln bewusst als Daten gehalten – leicht anpassbar.
// ============================================================

export type ShippingZone = "d1" | "d1_de" | "ny_upstate" | "d2" | "d3" | "d4" | "unknown";

export const ZONE_META: Record<ShippingZone, { label: string; color: string }> = {
  d1_de: { label: "1 Versandtag (Deutschland)", color: "#9fd19a" },
  d1: { label: "1 Versandtag (Overnight NY/NJ)", color: "#3ecf6c" },
  ny_upstate: { label: "2 Tage (Upstate NY – kein Overnight)", color: "#dcb888" },
  d2: { label: "2 Versandtage (USA / Europa)", color: "#8ab4f8" },
  d3: { label: "3 Versandtage (Asien u.a.)", color: "#ab9df2" },
  d4: { label: "4+ Versandtage", color: "#e29a92" },
  unknown: { label: "Unbekannt (keine Adresse)", color: "#8a8a92" },
};

/** Städte in Upstate New York: UPS Overnight funktioniert dorthin NICHT. */
const UPSTATE_NY = new Set([
  "rochester", "buffalo", "albany", "syracuse", "utica", "ithaca",
  "binghamton", "watervliet", "amherst", "schenectady", "troy",
]);

const US_STATES =
  "AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC".split(" ");

/** US-Bundesstaat aus PLZ-/Ortsangaben herausfischen (Lexware-Daten sind unsauber). */
export function detectUsState(zip: string | null, city: string | null, street: string | null): string | null {
  const hay = ` ${zip ?? ""} ${city ?? ""} ${street ?? ""} `.toUpperCase();
  for (const st of US_STATES) {
    if (new RegExp(`[^A-Z]${st}[^A-Z]`).test(hay)) return st;
  }
  // Fallback über PLZ-Bereiche (nur für die Overnight-Zone relevant)
  const digits = (zip ?? "").match(/\b(\d{5})\b/)?.[1];
  if (digits) {
    const n = parseInt(digits, 10);
    if (n >= 10000 && n <= 14999) return "NY";
    if (n >= 7000 && n <= 8999) return "NJ";
  }
  return null;
}

/** Ortsnamen normalisieren: Kleinbuchstaben, ohne Ziffern/Kommas/Umlaute. */
export function normalizeCity(city: string | null): string {
  if (!city) return "";
  return city
    .toLowerCase()
    .split(",")[0]
    .replace(/[0-9]/g, "")
    .replace(/ä/g, "a").replace(/ö/g, "o").replace(/ü/g, "u").replace(/ß/g, "ss")
    .replace(/[^a-z ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Versandzone bestimmen (Land ISO-2, ggf. US-Staat + Ort). */
export function shippingZone(country: string | null, state: string | null, cityNorm: string): ShippingZone {
  const c = (country ?? "").toUpperCase();
  if (c === "US") {
    if (state === "NY" || state === "NJ") {
      if (UPSTATE_NY.has(cityNorm)) return "ny_upstate";
      return "d1";
    }
    return "d2";
  }
  if (c === "DE") return "d1_de";
  if (["AT", "NL", "BE", "LU", "FR", "CH", "GB", "IT", "ES", "DK", "PL", "CZ", "SK", "SE", "PT", "IE", "HU"].includes(c)) return "d2";
  if (["HK", "CN", "JP", "SG", "KR", "TW", "AE"].includes(c)) return "d3";
  if (c === "CA" || c === "MX") return "d2";
  if (["BR", "AU", "NZ", "AR", "CL"].includes(c)) return "d4";
  if (!c) return "unknown";
  return "d3";
}

/** Länder-Mittelpunkte als Fallback, wenn die Stadt unbekannt ist. */
const COUNTRY_COORDS: Record<string, [number, number]> = {
  US: [39.0, -98.0], DE: [51.0, 10.0], GB: [54.0, -2.0], NL: [52.2, 5.3],
  FR: [46.6, 2.4], ES: [40.3, -3.7], IT: [42.8, 12.6], AT: [47.6, 14.1],
  CH: [46.8, 8.2], HK: [22.32, 114.17], CN: [35.0, 105.0], JP: [36.5, 138.0],
  BR: [-14.0, -52.0], CA: [50.0, -95.0], DK: [56.0, 10.0], PL: [52.0, 19.0],
  SE: [62.0, 15.0], SK: [48.7, 19.5], CZ: [49.8, 15.5], AE: [24.0, 54.0],
  BE: [50.6, 4.5], PT: [39.5, -8.0], IE: [53.2, -7.7], HU: [47.2, 19.4],
};

/** Bekannte Kundenstädte → Koordinaten (bewusst grob, für die Kartenansicht). */
const CITY_COORDS: Record<string, [number, number]> = {
  // USA – Overnight-Zone & Umgebung
  "new york": [40.71, -74.01], "brooklyn": [40.68, -73.94], "staten island": [40.58, -74.15],
  "glen cove": [40.86, -73.63], "wantagh": [40.68, -73.51], "levittown": [40.73, -73.51],
  "new windsor": [41.48, -74.02], "salisbury mills": [41.44, -74.12],
  "westwood": [40.99, -74.03], "saddle brook": [40.9, -74.09], "totowa": [40.9, -74.22],
  "howell": [40.18, -74.2], "franklinville": [39.62, -75.06], "eatontown": [40.3, -74.05],
  // Upstate NY
  "rochester": [43.16, -77.61], "watervliet": [42.73, -73.7], "amherst": [42.98, -78.8],
  // USA – Rest
  "tampa": [27.95, -82.46], "el segundo": [33.92, -118.42], "mechanicsburg": [40.21, -77.01],
  "santa ana": [33.75, -117.87], "north kingstown": [41.55, -71.45], "cincinnati": [39.1, -84.51],
  "rockvale": [35.75, -86.51], "pensacola": [30.42, -87.22], "allendale": [42.97, -85.95],
  "arvada": [39.8, -105.09], "corona": [33.88, -117.57], "bettendorf": [41.53, -90.48],
  "dothan": [31.22, -85.39], "alpharetta": [34.08, -84.29], "sterling": [39.01, -77.43],
  "atlanta": [33.75, -84.39], "ashburn": [39.04, -77.49], "baton rouge": [30.45, -91.15],
  "maple plain": [45.01, -93.66], "bensalem": [40.1, -74.94], "blum": [32.14, -97.4],
  "porter ranch": [34.28, -118.55], "farley": [42.44, -91.01], "litchfield park": [33.49, -112.36],
  "lakewood": [47.17, -122.52], "van buren": [35.44, -94.35], "reisterstown": [39.47, -76.83],
  "pittsburgh": [40.44, -80.0], "rocklin": [38.79, -121.24], "naples": [26.14, -81.79],
  "tacoma": [47.25, -122.44], "vancouver wa": [45.64, -122.66], "kalamazoo": [42.29, -85.59],
  "mitchell": [43.71, -98.03], "clarksburg": [39.24, -77.28], "tustin": [33.74, -117.82],
  "jackson": [32.3, -90.18], "riverview": [27.87, -82.33], "hillsborough": [27.87, -82.33],
  "beaverton": [45.49, -122.8], "rossford": [41.61, -83.56], "affton": [38.55, -90.33],
  "denton": [33.21, -97.13], "henderson": [36.04, -115.0], "bowling green": [36.99, -86.44],
  "franklinton": [36.1, -78.46], "buford": [34.12, -84.0], "salem": [44.94, -123.03],
  "lawrenceville": [33.95, -83.99], "san diego": [32.72, -117.16], "las vegas": [36.17, -115.14],
  "fort lauderdale": [26.12, -80.14], "columbus": [32.46, -84.99], "petaluma": [38.23, -122.64],
  "franklin": [35.93, -86.87], "irwindale": [34.11, -117.94], "solana beach": [32.99, -117.27],
  "buffalo grove": [42.15, -87.96], "deerfield beach": [26.32, -80.1], "westport": [41.14, -73.36],
  "dallas": [41.34, -75.96], "clinton township": [42.59, -82.92], "coronado": [32.69, -117.18],
  "greenville": [34.85, -82.4], "mission viejo": [33.6, -117.67], "harveys lake": [41.37, -76.02],
  "pinellas park": [27.84, -82.7], "panama city beach": [30.18, -85.81], "pewaukee": [43.08, -88.26],
  "escondido": [33.12, -117.09], "seattle": [47.61, -122.33], "bothell": [47.76, -122.21],
  "huntington beach": [33.66, -118.0], "beavercreek": [39.71, -84.06], "dearborn": [42.32, -83.18],
  "bel air": [39.54, -76.35], "irvine": [33.68, -117.83], "delray beach": [26.46, -80.07],
  "city of industry": [34.02, -117.96], "blaine": [45.16, -93.23], "fenton": [38.51, -90.44],
  "oldsmar": [28.03, -82.66], "burbank": [34.18, -118.31], "mansfield": [53.15, -1.2],
  "woodbridge": [43.78, -79.6],
  // Europa
  "strullendorf": [49.85, 10.97], "brandenburg hoppegarten": [52.51, 13.66], "hoppegarten": [52.51, 13.66],
  "sulzbach saar": [49.3, 7.06], "braunschweig": [52.27, 10.52], "langen": [49.99, 8.67],
  "wuppertal": [51.26, 7.15], "berlin": [52.52, 13.4], "kirchheim bei munchen": [48.18, 11.75],
  "meiningen": [50.57, 10.42], "bremen": [53.08, 8.81], "dinkelsbuhl": [49.07, 10.32],
  "gorinchem": [51.83, 4.97], "roermond": [51.19, 5.99], "westzaan": [52.47, 4.77],
  "rhoon": [51.86, 4.42], "gouda": [52.01, 4.71], "hengelo": [52.27, 6.79],
  "amersfoort": [52.16, 5.39], "eindhoven": [51.44, 5.48],
  "sheffield": [53.38, -1.47], "shettfield": [53.38, -1.47], "sheffiled": [53.38, -1.47],
  "london": [51.51, -0.13], "cardiff": [51.48, -3.18], "harrow": [51.58, -0.33],
  "urchfont": [51.31, -1.94], "hertfordshire": [51.64, -0.47], "hampshire": [51.21, -1.48],
  "bolzano": [46.5, 11.35], "napoli": [40.85, 14.27],
  "glis": [46.31, 7.98], "wangen bei olten": [47.34, 7.87],
  "graz": [47.07, 15.44], "rannersdorf": [48.08, 16.48], "ober grafendorf": [48.15, 15.55],
  "villach": [46.61, 13.86], "altmunster": [47.9, 13.76],
  "lutterbach": [47.76, 7.28], "occitanie toulouse": [43.6, 1.44], "toulouse": [43.6, 1.44],
  "valencia": [39.47, -0.38], "valencian community grao de castellon": [39.97, 0.01],
  "aalborg": [57.05, 9.92],
  // Asien & Rest
  "kowloon": [22.32, 114.17], "tsuen wan": [22.37, 114.11], "shenzhen": [22.54, 114.06],
  "shanghai": [31.23, 121.47], "funabashi city chiba": [35.69, 139.98], "funabashi": [35.69, 139.98],
  "sao paulo": [-23.55, -46.63],
};

export function resolveCoords(params: {
  city: string | null;
  zip: string | null;
  country: string | null;
}): { lat: number; lng: number; precise: boolean } | null {
  const cityN = normalizeCity(params.city);
  const c = (params.country ?? "").toUpperCase();
  // Sonderfall: "Vancouver WA" vs. Vancouver/Kanada
  const key = cityN === "vancouver" && c === "US" ? "vancouver wa" : cityN;
  const hit = CITY_COORDS[key];
  if (hit) return { lat: hit[0], lng: hit[1], precise: true };
  const cc = COUNTRY_COORDS[c];
  if (cc) return { lat: cc[0], lng: cc[1], precise: false };
  return null;
}
