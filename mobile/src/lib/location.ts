import * as Location from 'expo-location';

export type Coordinates = { latitude: number; longitude: number; accuracy: number };

export async function getGpsLocation(): Promise<Coordinates> {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (permission.status !== Location.PermissionStatus.GRANTED) {
    throw new Error('Location permission is required. Retry permission or open Settings; no manual pin is available in this version.');
  }
  let position: Location.LocationObject | null = null;
  const deadline = Date.now() + 8_000;
  try {
    while (Date.now() < deadline) {
      const candidate = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('location timeout')), Math.max(1, deadline - Date.now()))),
      ]);
      if (candidate.coords.accuracy == null || !Number.isFinite(candidate.coords.accuracy)) continue;
      if (!position || candidate.coords.accuracy < (position.coords.accuracy ?? Number.POSITIVE_INFINITY)) position = candidate;
      if (candidate.coords.accuracy <= 25) break;
    }
  } catch {
    if (!position) throw new Error('Could not get your location. Check device location services and retry.');
  }
  if (!position) throw new Error('Could not get your location. Check device location services and retry.');
  const { latitude, longitude } = position.coords;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    throw new Error('The device returned invalid GPS coordinates. Retry location.');
  }
  return { latitude, longitude, accuracy: position.coords.accuracy ?? 5000 };
}
