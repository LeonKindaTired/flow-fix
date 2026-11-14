import * as Location from 'expo-location';

export type Coordinates = { latitude: number; longitude: number };

export async function getGpsLocation(): Promise<Coordinates> {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (permission.status !== Location.PermissionStatus.GRANTED) {
    throw new Error('Location permission is required. Retry permission or open Settings; no manual pin is available in this version.');
  }
  let position: Location.LocationObject;
  try {
    position = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Could not get your location. Check device location services and retry.')), 15_000)),
    ]);
  } catch {
    throw new Error('Could not get your location. Check device location services and retry.');
  }
  const { latitude, longitude } = position.coords;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    throw new Error('The device returned invalid GPS coordinates. Retry location.');
  }
  return { latitude, longitude };
}
