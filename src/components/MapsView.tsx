import {
  APILoadingStatus,
  APIProvider,
  AdvancedMarker,
  ColorScheme,
  InfoWindow,
  Map as GoogleMap,
  Pin,
  useAdvancedMarkerRef,
  useApiLoadingStatus,
  useMap,
  useMapsLibrary,
} from '@vis.gl/react-google-maps';
import {
  Clock,
  Compass,
  ExternalLink,
  Loader2,
  LocateFixed,
  MapPin,
  Navigation,
  Route as RouteIcon,
  Search,
  Star,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { LanguagePreference, MapLocationRequest } from '../types/assistant';

interface MapsViewProps {
  language: LanguagePreference;
  pendingRequest: MapLocationRequest | null;
  onConsumePendingRequest: () => void;
}

type MapsMode = 'places' | 'directions';
type TravelModeOption = 'DRIVING' | 'WALKING' | 'BICYCLING' | 'TRANSIT';

interface PlaceSummary {
  id: string;
  name: string;
  address: string;
  location: google.maps.LatLngLiteral;
  viewport?: google.maps.LatLngBounds | null;
  rating?: number | null;
  userRatingCount?: number | null;
  businessStatus?: string | null;
  googleMapsURI?: string | null;
  iconBackgroundColor?: string | null;
  svgIconMaskURI?: string | null;
}

interface RouteSummaryInfo {
  distanceText: string;
  durationText: string;
  originLabel: string;
  destinationLabel: string;
  travelMode: TravelModeOption;
}

const DEFAULT_CENTER: google.maps.LatLngLiteral = {
  lat: 14.5995,
  lng: 120.9842,
};

const QUICK_CATEGORIES: ReadonlyArray<{ label: string; query: string }> = [
  { label: 'Coffee Shops', query: 'coffee shops' },
  { label: 'Restaurants', query: 'restaurants' },
  { label: 'Pharmacies', query: 'pharmacy' },
  { label: 'Hospitals', query: 'hospital' },
];

const TRAVEL_MODES: ReadonlyArray<{ value: TravelModeOption; label: string }> = [
  { value: 'DRIVING', label: 'Drive' },
  { value: 'WALKING', label: 'Walk' },
  { value: 'TRANSIT', label: 'Transit' },
  { value: 'BICYCLING', label: 'Bike' },
];

function isQuotaError(err: unknown): boolean {
  if (!err) return false;
  const text =
    err instanceof Error
      ? err.message
      : typeof err === 'object'
        ? JSON.stringify(err)
        : String(err);
  const upper = text.toUpperCase();
  return (
    upper.includes('RESOURCE_EXHAUSTED') ||
    upper.includes('OVER_QUERY_LIMIT') ||
    upper.includes('OVERQUOTAMAPERROR') ||
    upper.includes('QUOTAEXCEEDED') ||
    upper.includes('QUOTA') ||
    text.includes('429')
  );
}

function dispatchQuotaExceeded(): void {
  window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
}

function formatDistance(meters?: number | null): string {
  if (!meters || meters <= 0) return '—';
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`;
  return `${Math.round(meters)} m`;
}

function formatDuration(millis?: number | null): string {
  if (!millis || millis <= 0) return '—';
  const totalMins = Math.max(1, Math.round(millis / 60000));
  if (totalMins < 60) return `${totalMins} min`;
  const hrs = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  return mins > 0 ? `${hrs} hr ${mins} min` : `${hrs} hr`;
}

function toPlaceSummary(place: google.maps.places.Place): PlaceSummary | null {
  if (!place.location) return null;
  const lat =
    typeof place.location.lat === 'function' ? place.location.lat() : Number(place.location.lat);
  const lng =
    typeof place.location.lng === 'function' ? place.location.lng() : Number(place.location.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  return {
    id: place.id || `${lat}-${lng}`,
    name: place.displayName || 'Selected Location',
    address: place.formattedAddress || 'Address unavailable',
    location: { lat, lng },
    viewport: place.viewport ?? null,
    rating: place.rating ?? null,
    userRatingCount: place.userRatingCount ?? null,
    businessStatus: place.businessStatus ?? null,
    googleMapsURI: place.googleMapsURI ?? null,
    iconBackgroundColor: place.iconBackgroundColor ?? null,
    svgIconMaskURI: place.svgIconMaskURI ?? null,
  };
}

function useAutocompleteSuggestions(inputString: string) {
  const placesLib = useMapsLibrary('places');
  const sessionTokenRef = useRef<google.maps.places.AutocompleteSessionToken | null>(null);
  const [suggestions, setSuggestions] = useState<google.maps.places.AutocompleteSuggestion[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const trimmed = inputString.trim();
    if (!placesLib || trimmed.length < 2) {
      setSuggestions([]);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    const timer = window.setTimeout(async () => {
      try {
        const { AutocompleteSessionToken, AutocompleteSuggestion } = placesLib;
        if (!sessionTokenRef.current) {
          sessionTokenRef.current = new AutocompleteSessionToken();
        }
        const res = await AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input: trimmed,
          sessionToken: sessionTokenRef.current,
        });
        if (!cancelled) {
          setSuggestions(res?.suggestions ?? []);
        }
      } catch (err) {
        if (isQuotaError(err)) {
          dispatchQuotaExceeded();
        }
        if (!cancelled) {
          setSuggestions([]);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }, 240);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [placesLib, inputString]);

  const resetSession = useCallback(() => {
    sessionTokenRef.current = null;
    setSuggestions([]);
  }, []);

  return { suggestions, isLoading, resetSession };
}

interface PlaceMarkerItemProps {
  place: PlaceSummary;
  isSelected: boolean;
  onSelect: (place: PlaceSummary) => void;
  onCloseInfo: () => void;
  onSetDestination: (place: PlaceSummary) => void;
}

function PlaceMarkerItem({
  place,
  isSelected,
  onSelect,
  onCloseInfo,
  onSetDestination,
}: PlaceMarkerItemProps) {
  const [markerRef, marker] = useAdvancedMarkerRef();

  return (
    <>
      <AdvancedMarker
        ref={markerRef}
        position={place.location}
        title={place.name}
        onClick={() => onSelect(place)}
      >
        <Pin
          background={isSelected ? '#2563EB' : place.iconBackgroundColor || '#0EA5E9'}
          borderColor={isSelected ? '#93C5FD' : '#0369A1'}
          glyphColor="#FFFFFF"
          scale={isSelected ? 1.2 : 1}
        />
      </AdvancedMarker>

      {isSelected && marker && (
        <InfoWindow anchor={marker} maxWidth={260} onCloseClick={onCloseInfo}>
          <div className="space-y-1.5 text-slate-900">
            <div className="text-sm font-semibold leading-snug">{place.name}</div>
            <div className="text-xs text-slate-600 leading-snug">{place.address}</div>
            {typeof place.rating === 'number' && (
              <div className="flex items-center gap-1 text-xs font-medium text-amber-700">
                <Star className="h-3.5 w-3.5 fill-amber-500 text-amber-500" />
                <span>{place.rating.toFixed(1)}</span>
                {typeof place.userRatingCount === 'number' && (
                  <span className="text-slate-500">({place.userRatingCount.toLocaleString()})</span>
                )}
              </div>
            )}
            <div className="flex items-center gap-3 pt-1">
              <button
                type="button"
                onClick={() => onSetDestination(place)}
                className="text-xs font-semibold text-blue-700 hover:underline"
              >
                Directions here
              </button>
              {place.googleMapsURI && (
                <a
                  href={place.googleMapsURI}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-medium text-slate-700 hover:underline"
                >
                  <span>Open Maps</span>
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          </div>
        </InfoWindow>
      )}
    </>
  );
}

interface MapsWorkspaceProps {
  pendingRequest: MapLocationRequest | null;
  onConsumePendingRequest: () => void;
  regionCode: 'PH' | 'US';
  onChangeRegion: (region: 'PH' | 'US') => void;
}

function MapsWorkspace({
  pendingRequest,
  onConsumePendingRequest,
  regionCode,
  onChangeRegion,
}: MapsWorkspaceProps) {
  const map = useMap();
  const coreLib = useMapsLibrary('core');
  const placesLib = useMapsLibrary('places');
  const routesLib = useMapsLibrary('routes');
  const loadingStatus = useApiLoadingStatus();

  const [mode, setMode] = useState<MapsMode>('places');
  const [searchInput, setSearchInput] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [places, setPlaces] = useState<PlaceSummary[]>([]);
  const [selectedPlace, setSelectedPlace] = useState<PlaceSummary | null>(null);
  const [userLocation, setUserLocation] = useState<google.maps.LatLngLiteral | null>(null);
  const [locating, setLocating] = useState(false);
  const [searching, setSearching] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);

  // Directions state
  const [originInput, setOriginInput] = useState('');
  const [destinationInput, setDestinationInput] = useState('');
  const [travelMode, setTravelMode] = useState<TravelModeOption>('DRIVING');
  const [routeSummary, setRouteSummary] = useState<RouteSummaryInfo | null>(null);
  const [routingLoading, setRoutingLoading] = useState(false);
  const polylinesRef = useRef<google.maps.Polyline[]>([]);

  const { suggestions, isLoading: suggestionsLoading, resetSession } =
    useAutocompleteSuggestions(searchInput);

  const clearRoutePolylines = useCallback(() => {
    for (const poly of polylinesRef.current) {
      poly.setMap(null);
    }
    polylinesRef.current = [];
  }, []);

  useEffect(() => {
    return () => {
      clearRoutePolylines();
    };
  }, [clearRoutePolylines]);

  const focusPlaceOnMap = useCallback(
    (place: PlaceSummary) => {
      setSelectedPlace(place);
      if (!map) return;
      if (place.viewport) {
        map.fitBounds(place.viewport);
      } else {
        map.panTo(place.location);
        map.setZoom(15);
      }
    },
    [map]
  );

  const runTextSearch = useCallback(
    async (queryText: string) => {
      const trimmed = queryText.trim();
      if (!trimmed || !placesLib) return;

      setSearching(true);
      setMapError(null);
      setShowSuggestions(false);
      clearRoutePolylines();
      setRouteSummary(null);

      try {
        const biasCenter = userLocation ?? map?.getCenter()?.toJSON() ?? DEFAULT_CENTER;
        const { places: foundPlaces } = await placesLib.Place.searchByText({
          textQuery: trimmed,
          fields: [
            'id',
            'displayName',
            'formattedAddress',
            'location',
            'viewport',
            'rating',
            'userRatingCount',
            'businessStatus',
            'googleMapsURI',
            'svgIconMaskURI',
            'iconBackgroundColor',
          ],
          locationBias: biasCenter,
          maxResultCount: 8,
        });

        const parsed = (foundPlaces ?? [])
          .map(toPlaceSummary)
          .filter((item: PlaceSummary | null): item is PlaceSummary => item !== null);

        setPlaces(parsed);
        if (parsed.length === 0) {
          setSelectedPlace(null);
          setMapError(`No matching places found for "${trimmed}".`);
          return;
        }

        const first = parsed[0];
        setSelectedPlace(first);

        if (map) {
          if (parsed.length === 1) {
            if (first.viewport) {
              map.fitBounds(first.viewport);
            } else {
              map.panTo(first.location);
              map.setZoom(15);
            }
          } else if (coreLib) {
            const bounds = new coreLib.LatLngBounds();
            for (const p of parsed) {
              bounds.extend(p.location);
            }
            map.fitBounds(bounds);
          }
        }
      } catch (err) {
        if (isQuotaError(err)) {
          dispatchQuotaExceeded();
          setMapError('Unable to load places right now due to Maps quota limits.');
        } else {
          setMapError(err instanceof Error ? err.message : 'Unable to search places.');
        }
      } finally {
        setSearching(false);
      }
    },
    [clearRoutePolylines, coreLib, map, placesLib, userLocation]
  );

  const handleSelectSuggestion = useCallback(
    async (suggestion: google.maps.places.AutocompleteSuggestion) => {
      if (!placesLib || !suggestion.placePrediction) return;
      setSearching(true);
      setMapError(null);
      setShowSuggestions(false);
      clearRoutePolylines();
      setRouteSummary(null);

      try {
        const place = suggestion.placePrediction.toPlace();
        await place.fetchFields({
          fields: [
            'id',
            'displayName',
            'formattedAddress',
            'location',
            'viewport',
            'rating',
            'userRatingCount',
            'businessStatus',
            'googleMapsURI',
            'svgIconMaskURI',
            'iconBackgroundColor',
          ],
        });
        resetSession();

        const summary = toPlaceSummary(place);
        if (!summary) {
          setMapError('Selected place did not include map coordinates.');
          return;
        }
        setSearchInput(summary.name);
        setPlaces([summary]);
        focusPlaceOnMap(summary);
      } catch (err) {
        if (isQuotaError(err)) {
          dispatchQuotaExceeded();
          setMapError('Unable to load place details due to Maps quota limits.');
        } else {
          setMapError(err instanceof Error ? err.message : 'Unable to load place details.');
        }
      } finally {
        setSearching(false);
      }
    },
    [clearRoutePolylines, focusPlaceOnMap, placesLib, resetSession]
  );

  const computeDirections = useCallback(
    async (originText: string, destinationText: string, chosenMode: TravelModeOption) => {
      if (!routesLib || !map) return;
      const destTrimmed = destinationText.trim();
      const origTrimmed = originText.trim();
      if (!destTrimmed) {
        setMapError('Enter a destination to calculate a route.');
        return;
      }

      const resolvedOrigin: string | google.maps.LatLngLiteral =
        origTrimmed === 'My Current Location' && userLocation
          ? userLocation
          : origTrimmed || userLocation || 'Manila, Philippines';

      setRoutingLoading(true);
      setMapError(null);
      clearRoutePolylines();
      setRouteSummary(null);

      try {
        const sdkTravelMode =
          routesLib.TravelMode[chosenMode as keyof typeof routesLib.TravelMode] ??
          routesLib.TravelMode.DRIVING;

        const response = await routesLib.Route.computeRoutes({
          origin: resolvedOrigin,
          destination: destTrimmed,
          travelMode: sdkTravelMode,
          fields: ['path', 'distanceMeters', 'durationMillis', 'viewport', 'legs', 'localizedValues'],
        });

        const primaryRoute = response?.routes?.[0];
        if (!primaryRoute) {
          setMapError('No route found between those locations.');
          return;
        }

        const newPolylines = primaryRoute.createPolylines({
          polylineOptions: {
            strokeColor: '#3B82F6',
            strokeWeight: 5,
            strokeOpacity: 0.92,
          },
        });
        for (const poly of newPolylines) {
          poly.setMap(map);
        }
        polylinesRef.current = newPolylines;

        if (primaryRoute.viewport) {
          map.fitBounds(primaryRoute.viewport);
        }

        setRouteSummary({
          distanceText:
            primaryRoute.localizedValues?.distance ?? formatDistance(primaryRoute.distanceMeters),
          durationText:
            primaryRoute.localizedValues?.duration ?? formatDuration(primaryRoute.durationMillis),
          originLabel: origTrimmed || (userLocation ? 'Current Location' : 'Manila'),
          destinationLabel: destTrimmed,
          travelMode: chosenMode,
        });
      } catch (err) {
        if (isQuotaError(err)) {
          dispatchQuotaExceeded();
          setMapError('Unable to compute route due to Maps quota limits.');
        } else {
          setMapError(err instanceof Error ? err.message : 'Unable to compute route.');
        }
      } finally {
        setRoutingLoading(false);
      }
    },
    [clearRoutePolylines, map, routesLib, userLocation]
  );

  // Sync voice/chat map commands once libraries are ready
  useEffect(() => {
    if (!pendingRequest) return;
    if (pendingRequest.destination) {
      if (!routesLib || !map) return;
      const modeVal = pendingRequest.travelMode ?? 'DRIVING';
      setMode('directions');
      setOriginInput(pendingRequest.origin || (userLocation ? 'My Current Location' : ''));
      setDestinationInput(pendingRequest.destination);
      setTravelMode(modeVal);
      void computeDirections(
        pendingRequest.origin || '',
        pendingRequest.destination,
        modeVal
      );
      onConsumePendingRequest();
      return;
    }

    if (pendingRequest.query && placesLib) {
      setMode('places');
      setSearchInput(pendingRequest.query);
      void runTextSearch(pendingRequest.query);
      onConsumePendingRequest();
    }
  }, [
    computeDirections,
    map,
    onConsumePendingRequest,
    pendingRequest,
    placesLib,
    routesLib,
    runTextSearch,
    userLocation,
  ]);

  const handleLocateUser = useCallback(() => {
    if (!navigator.geolocation) {
      setMapError('Geolocation is not supported in this browser environment.');
      return;
    }
    setLocating(true);
    setMapError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        };
        setUserLocation(coords);
        if (map) {
          map.panTo(coords);
          map.setZoom(14);
        }
        if (mode === 'directions' && !originInput.trim()) {
          setOriginInput('My Current Location');
        }
        setLocating(false);
      },
      (err) => {
        setLocating(false);
        setMapError(`Location unavailable: ${err.message}`);
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }, [map, mode, originInput]);

  const handleSetDestinationFromPlace = useCallback(
    (place: PlaceSummary) => {
      setMode('directions');
      setDestinationInput(place.address !== 'Address unavailable' ? place.address : place.name);
      if (!originInput.trim() && userLocation) {
        setOriginInput('My Current Location');
      }
      if (originInput.trim() || userLocation) {
        void computeDirections(
          originInput.trim() || 'My Current Location',
          place.address !== 'Address unavailable' ? place.address : place.name,
          travelMode
        );
      }
    },
    [computeDirections, originInput, travelMode, userLocation]
  );

  const authFailed =
    loadingStatus === APILoadingStatus.AUTH_FAILURE || loadingStatus === APILoadingStatus.FAILED;

  return (
    <div className="mx-auto flex h-full max-w-6xl flex-col gap-4 px-4 py-5 lg:px-8">
      {/* Top Controls & Mode Switch */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-[#121826] px-4 py-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setMode('places')}
            className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              mode === 'places'
                ? 'bg-blue-600 text-white'
                : 'border border-white/10 bg-[#0B0F17] text-slate-300 hover:bg-white/5'
            }`}
          >
            <Search className="h-3.5 w-3.5" />
            <span>Explore Places</span>
          </button>
          <button
            type="button"
            onClick={() => setMode('directions')}
            className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              mode === 'directions'
                ? 'bg-blue-600 text-white'
                : 'border border-white/10 bg-[#0B0F17] text-slate-300 hover:bg-white/5'
            }`}
          >
            <RouteIcon className="h-3.5 w-3.5" />
            <span>Route Planner</span>
          </button>
        </div>

        <div className="flex items-center gap-2.5">
          <label htmlFor="maps-region-select" className="text-xs text-slate-400 whitespace-nowrap">
            Region
          </label>
          <select
            id="maps-region-select"
            value={regionCode}
            onChange={(e) => onChangeRegion(e.target.value as 'PH' | 'US')}
            className="rounded-lg border border-white/10 bg-[#0B0F17] px-2.5 py-1.5 text-xs font-medium text-slate-200 focus:border-blue-500 focus:outline-none"
          >
            <option value="PH">Philippines (PH)</option>
            <option value="US">United States (US)</option>
          </select>

          <button
            type="button"
            onClick={handleLocateUser}
            disabled={locating}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-[#0B0F17] px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:border-blue-500/50 hover:bg-white/5 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            {locating ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-400" />
            ) : (
              <LocateFixed className="h-3.5 w-3.5 text-blue-400" />
            )}
            <span>My Location</span>
          </button>
        </div>
      </div>

      {mapError && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-200">
          <span>{mapError}</span>
          <button
            type="button"
            onClick={() => setMapError(null)}
            className="rounded p-1 text-amber-300 hover:bg-amber-500/20"
            aria-label="Dismiss map notice"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Split Workspace: Left Search/Results Panel + Right Interactive Map */}
      <div className="grid min-h-[460px] flex-1 grid-cols-1 gap-4 lg:grid-cols-12">
        {/* Left Panel */}
        <section className="flex flex-col rounded-xl border border-white/10 bg-[#121826] p-4 lg:col-span-5">
          {mode === 'places' ? (
            <>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void runTextSearch(searchInput);
                }}
                className="relative"
              >
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      value={searchInput}
                      onFocus={() => setShowSuggestions(true)}
                      onChange={(e) => {
                        setSearchInput(e.target.value);
                        setShowSuggestions(true);
                      }}
                      placeholder="Search places, landmarks, or addresses..."
                      className="w-full rounded-lg border border-white/10 bg-[#0B0F17] py-2.5 pl-9 pr-8 text-sm text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
                    />
                    {searchInput && (
                      <button
                        type="button"
                        onClick={() => {
                          setSearchInput('');
                          resetSession();
                          setShowSuggestions(false);
                        }}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
                        aria-label="Clear search"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  <button
                    type="submit"
                    disabled={!searchInput.trim() || searching || !placesLib}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2.5 text-xs font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-50 whitespace-nowrap shrink-0"
                  >
                    {searching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Search'}
                  </button>
                </div>

                {/* Modern AutocompleteSuggestion Dropdown */}
                {showSuggestions && (suggestions.length > 0 || suggestionsLoading) && (
                  <div className="absolute left-0 right-0 top-full z-20 mt-1.5 max-h-60 overflow-y-auto rounded-lg border border-white/15 bg-[#0E131F] shadow-xl">
                    {suggestionsLoading ? (
                      <div className="flex items-center gap-2 px-3.5 py-2.5 text-xs text-slate-400">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        <span>Finding suggestions...</span>
                      </div>
                    ) : (
                      <ul className="divide-y divide-white/5">
                        {suggestions.map((suggestion, idx) => {
                          const label = suggestion.placePrediction?.text?.text;
                          if (!label) return null;
                          return (
                            <li key={`${label}-${idx}`}>
                              <button
                                type="button"
                                onClick={() => void handleSelectSuggestion(suggestion)}
                                className="flex w-full items-start gap-2.5 px-3.5 py-2.5 text-left text-xs text-slate-200 transition-colors hover:bg-white/5"
                              >
                                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-400" />
                                <span className="leading-snug">{label}</span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                )}
              </form>

              {/* Quick Category Buttons */}
              <div className="mt-3 flex flex-wrap gap-1.5">
                {QUICK_CATEGORIES.map((cat) => (
                  <button
                    key={cat.query}
                    type="button"
                    disabled={!placesLib || searching}
                    onClick={() => {
                      setSearchInput(cat.query);
                      void runTextSearch(cat.query);
                    }}
                    className="rounded-md border border-white/10 bg-[#0B0F17] px-2.5 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:border-blue-500/40 hover:text-white disabled:opacity-50 whitespace-nowrap shrink-0"
                  >
                    {cat.label}
                  </button>
                ))}
              </div>

              {/* Place Results List */}
              <div className="mt-4 flex-1 space-y-2 overflow-y-auto pr-1">
                {places.length === 0 ? (
                  <div className="flex h-full min-h-[220px] flex-col items-center justify-center rounded-lg border border-dashed border-white/10 bg-[#0B0F17]/50 p-5 text-center">
                    <Compass className="h-7 w-7 text-slate-500" />
                    <p className="mt-2.5 text-sm font-medium text-slate-200">
                      Search Google Maps Places
                    </p>
                    <p className="mt-1 max-w-xs text-xs text-slate-400">
                      Type a destination, choose a quick category above, or ask Hey Assistant AI by
                      voice to locate places on the map.
                    </p>
                  </div>
                ) : (
                  places.map((place) => {
                    const active = selectedPlace?.id === place.id;
                    return (
                      <div
                        key={place.id}
                        className={`rounded-lg border p-3 transition-colors ${
                          active
                            ? 'border-blue-500/60 bg-blue-600/10'
                            : 'border-white/10 bg-[#0B0F17] hover:border-white/20'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => focusPlaceOnMap(place)}
                          className="w-full text-left"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <span className="text-sm font-semibold text-slate-100">
                              {place.name}
                            </span>
                            {typeof place.rating === 'number' && (
                              <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-300 shrink-0">
                                <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                                {place.rating.toFixed(1)}
                              </span>
                            )}
                          </div>
                          <p className="mt-1 text-xs text-slate-400 leading-relaxed">
                            {place.address}
                          </p>
                        </button>
                        <div className="mt-2.5 flex items-center gap-3 border-t border-white/5 pt-2 text-xs">
                          <button
                            type="button"
                            onClick={() => handleSetDestinationFromPlace(place)}
                            className="inline-flex items-center gap-1 font-medium text-blue-400 hover:underline"
                          >
                            <Navigation className="h-3 w-3" />
                            <span>Directions</span>
                          </button>
                          {place.googleMapsURI && (
                            <a
                              href={place.googleMapsURI}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-slate-400 hover:text-slate-200 hover:underline"
                            >
                              <span>Google Maps</span>
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void computeDirections(originInput, destinationInput, travelMode);
              }}
              className="flex flex-1 flex-col space-y-3"
            >
              <div>
                <label htmlFor="route-origin" className="block text-xs font-medium text-slate-300">
                  Origin
                </label>
                <div className="mt-1 flex gap-2">
                  <input
                    id="route-origin"
                    type="text"
                    value={originInput}
                    onChange={(e) => setOriginInput(e.target.value)}
                    placeholder="Starting address or My Current Location"
                    className="min-w-0 flex-1 rounded-lg border border-white/10 bg-[#0B0F17] px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
                  />
                  {userLocation && (
                    <button
                      type="button"
                      onClick={() => setOriginInput('My Current Location')}
                      className="rounded-lg border border-white/10 bg-[#0B0F17] px-2.5 py-2 text-xs text-blue-400 hover:bg-white/5 whitespace-nowrap shrink-0"
                    >
                      GPS
                    </button>
                  )}
                </div>
              </div>

              <div>
                <label
                  htmlFor="route-destination"
                  className="block text-xs font-medium text-slate-300"
                >
                  Destination
                </label>
                <input
                  id="route-destination"
                  type="text"
                  value={destinationInput}
                  onChange={(e) => setDestinationInput(e.target.value)}
                  placeholder="Destination address or landmark"
                  className="mt-1 w-full rounded-lg border border-white/10 bg-[#0B0F17] px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
                />
              </div>

              <div>
                <span className="block text-xs font-medium text-slate-300">Travel Mode</span>
                <div className="mt-1.5 grid grid-cols-4 gap-1.5">
                  {TRAVEL_MODES.map((m) => (
                    <button
                      key={m.value}
                      type="button"
                      onClick={() => setTravelMode(m.value)}
                      className={`rounded-lg border px-2 py-2 text-xs font-medium transition-colors whitespace-nowrap ${
                        travelMode === m.value
                          ? 'border-blue-500/60 bg-blue-600/20 text-blue-300'
                          : 'border-white/10 bg-[#0B0F17] text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              <button
                type="submit"
                disabled={routingLoading || !destinationInput.trim() || !routesLib}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-50"
              >
                {routingLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Navigation className="h-4 w-4" />
                )}
                <span>Calculate Route</span>
              </button>

              {routeSummary ? (
                <div className="rounded-lg border border-blue-500/30 bg-[#0B0F17] p-4 space-y-2">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>Route Summary · {routeSummary.travelMode}</span>
                    <button
                      type="button"
                      onClick={() => {
                        clearRoutePolylines();
                        setRouteSummary(null);
                      }}
                      className="text-slate-400 hover:text-slate-200"
                    >
                      Clear
                    </button>
                  </div>
                  <div className="flex items-baseline gap-4">
                    <div className="text-xl font-bold text-slate-100 font-mono tabular-nums">
                      {routeSummary.durationText}
                    </div>
                    <div className="text-sm text-blue-400 font-mono tabular-nums">
                      {routeSummary.distanceText}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-slate-400 pt-1">
                    <Clock className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">
                      {routeSummary.originLabel} → {routeSummary.destinationLabel}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="flex flex-1 flex-col items-center justify-center rounded-lg border border-dashed border-white/10 bg-[#0B0F17]/50 p-5 text-center">
                  <RouteIcon className="h-7 w-7 text-slate-500" />
                  <p className="mt-2 text-xs text-slate-400">
                    Enter an origin and destination to compute travel time, distance, and route path
                    using the modern Routes API.
                  </p>
                </div>
              )}
            </form>
          )}
        </section>

        {/* Right Panel: Explicit-height Map Container (CF2) */}
        <section className="relative h-[440px] lg:h-[calc(100vh-14.5rem)] min-h-[420px] overflow-hidden rounded-xl border border-white/10 bg-[#0B0F17] lg:col-span-7">
          {authFailed ? (
            <div className="flex h-full flex-col items-center justify-center p-6 text-center">
              <MapPin className="h-8 w-8 text-amber-400" />
              <p className="mt-3 text-sm font-medium text-slate-200">
                Google Maps could not initialize with the current credentials.
              </p>
              <p className="mt-1 max-w-md text-xs text-slate-400">
                Verify your Google Maps Platform quota or API key restrictions if this persists.
              </p>
            </div>
          ) : (
            <GoogleMap
              defaultCenter={DEFAULT_CENTER}
              defaultZoom={12}
              mapId="DEMO_MAP_ID"
              gestureHandling="greedy"
              colorScheme={ColorScheme.DARK}
              clickableIcons={false}
              internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
              onClick={() => setSelectedPlace(null)}
              className="h-full w-full"
            >
              {userLocation && (
                <AdvancedMarker position={userLocation} title="Your Location">
                  <div className="h-4 w-4 rounded-full border-2 border-white bg-blue-500 shadow-lg" />
                </AdvancedMarker>
              )}

              {places.map((place) => (
                <PlaceMarkerItem
                  key={place.id}
                  place={place}
                  isSelected={selectedPlace?.id === place.id}
                  onSelect={focusPlaceOnMap}
                  onCloseInfo={() => setSelectedPlace(null)}
                  onSetDestination={handleSetDestinationFromPlace}
                />
              ))}
            </GoogleMap>
          )}
        </section>
      </div>
    </div>
  );
}

export function MapsView({
  language,
  pendingRequest,
  onConsumePendingRequest,
}: MapsViewProps) {
  const envKey = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined) ?? '';
  const [mapsApiKey, setMapsApiKey] = useState<string>(
    envKey && envKey !== 'MY_GOOGLE_MAPS_API_KEY' ? envKey : ''
  );
  const [keyChecked, setKeyChecked] = useState<boolean>(Boolean(mapsApiKey));
  const [regionCode, setRegionCode] = useState<'PH' | 'US'>('PH');

  useEffect(() => {
    if (mapsApiKey) return;
    let cancelled = false;
    fetch('/api/maps-config')
      .then((res) => (res.ok ? res.json() : { apiKey: '' }))
      .then((data: { apiKey?: string }) => {
        if (!cancelled) {
          if (data.apiKey) setMapsApiKey(data.apiKey);
          setKeyChecked(true);
        }
      })
      .catch(() => {
        if (!cancelled) setKeyChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, [mapsApiKey]);

  const sdkLanguage = language === 'tl' ? 'fil' : 'en';

  if (!keyChecked) {
    return (
      <div className="flex h-full min-h-[420px] items-center justify-center p-6">
        <div className="flex items-center gap-2.5 text-sm text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin text-blue-400" />
          <span>Loading Google Maps configuration...</span>
        </div>
      </div>
    );
  }

  if (!mapsApiKey) {
    return (
      <div className="mx-auto flex h-full max-w-2xl flex-col items-center justify-center p-6 text-center">
        <div className="rounded-xl border border-white/10 bg-[#121826] p-6">
          <MapPin className="mx-auto h-8 w-8 text-blue-400" />
          <h2 className="mt-3 text-base font-semibold text-slate-100">
            Google Maps API Key Not Available
          </h2>
          <p className="mt-2 text-xs leading-relaxed text-slate-400">
            Configure <code className="text-slate-200">VITE_GOOGLE_MAPS_API_KEY</code> in your
            environment secrets or local <code className="text-slate-200">.env</code> file to enable
            interactive Maps, Places search, and Route planning.
          </p>
        </div>
      </div>
    );
  }

  return (
    <APIProvider
      apiKey={mapsApiKey}
      libraries={['places', 'routes', 'marker']}
      language={sdkLanguage}
      region={regionCode}
    >
      <MapsWorkspace
        pendingRequest={pendingRequest}
        onConsumePendingRequest={onConsumePendingRequest}
        regionCode={regionCode}
        onChangeRegion={setRegionCode}
      />
    </APIProvider>
  );
}
