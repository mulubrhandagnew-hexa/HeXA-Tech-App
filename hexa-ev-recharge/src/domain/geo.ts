/**
 * Geography helpers for matching providers to vehicles and estimating ETAs.
 */
import { HubError } from "./errors.js";

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

const EARTH_RADIUS_MILES = 3958.8;

/** Average road speed assumed for ETA estimates, in mph. */
export const AVERAGE_SPEED_MPH = 25;

/** Fixed minutes added to every ETA for parking and setup. */
export const ETA_BUFFER_MINUTES = 5;

export function assertPoint(p: GeoPoint, label = "location"): GeoPoint {
  if (!(p.latitude >= -90 && p.latitude <= 90) || !(p.longitude >= -180 && p.longitude <= 180)) {
    throw new HubError("invalid", `${label} has invalid coordinates`);
  }
  return p;
}

/** Great-circle distance in miles (haversine). */
export function distanceMiles(a: GeoPoint, b: GeoPoint): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Whole-minute ETA for a provider at `from` driving to `to`. */
export function etaMinutes(from: GeoPoint, to: GeoPoint): number {
  return Math.ceil((distanceMiles(from, to) / AVERAGE_SPEED_MPH) * 60) + ETA_BUFFER_MINUTES;
}
