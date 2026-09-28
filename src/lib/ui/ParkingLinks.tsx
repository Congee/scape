import { parkingServices, parkingUrl } from '@core/geo/parking';
import { useMapStatus } from '@state/mapStatus';
import { useWorld } from '@state/world';

/** Parking search links for a city camera spot; nothing is fetched until one is clicked. */
export function ParkingLinks() {
  const pin = useWorld((s) => s.pin);
  const sensed = useMapStatus((s) => s.urban);
  const urban = sensed && sensed.p.lat === pin.lat && sensed.p.lng === pin.lng ? sensed.urban : null;
  const services = parkingServices(pin, urban);
  if (services.length === 0) return null;
  return (
    <div className="parking" data-testid="parking">
      <span className="label">Parking</span>
      {services.map((s) => (
        <a key={s} href={parkingUrl(s, pin)} target="_blank" rel="noopener noreferrer" title={`Parking near the camera spot on ${s}`}>
          {s} ↗
        </a>
      ))}
    </div>
  );
}
