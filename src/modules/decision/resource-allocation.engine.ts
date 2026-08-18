import {
  AllocationEngineInput,
  AllocationResult,
  CandidateEvaluation,
  ResourceCandidate,
} from './decision.interface';

// ─── Haversine distance ───────────────────────────────────────────────────────
/**
 * Calculates the great-circle distance between two geographic points.
 *
 * Formula: https://en.wikipedia.org/wiki/Haversine_formula
 *
 * Returns distance in kilometres.
 * This is a straight-line approximation — road distance will always be longer.
 * Distance is used as a proxy for travel time until a real routing service
 * is integrated.
 */
export function haversineDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371; // Earth radius in km
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 100) / 100; // round to 2 decimal places
}

// ─── ETA estimation ───────────────────────────────────────────────────────────
/**
 * Estimates travel time in minutes.
 *
 * ETA = (distanceKm / speedKmh) * 60
 *
 * NOTE: This is a straight-line approximation using a configurable average
 * speed (default 60 km/h). It does not account for traffic, road conditions,
 * or actual routing. Replace with a real routing API in a future part.
 */
export function estimateEtaMinutes(
  distanceKm: number,
  averageSpeedKmh: number,
): number {
  if (averageSpeedKmh <= 0) return Infinity;
  return Math.round((distanceKm / averageSpeedKmh) * 60 * 100) / 100;
}

// ─── Resource type matching ───────────────────────────────────────────────────
/**
 * Determines whether a resource type satisfies any of the incident requirements.
 *
 * Matching strategy:
 *   - If the incident has NO requirements, any resource type is considered
 *     suitable (the incident did not specify constraints).
 *   - If requirements exist, the resource type must appear in the list.
 *   - Comparison is case-insensitive.
 *
 * This is intentionally simple — one resource satisfies one requirement type.
 * Future capability data (e.g. equipment loadout) can extend this logic.
 */
function isTypeMatch(
  resourceType: string,
  requirements: string[],
): boolean {
  if (requirements.length === 0) return true;
  return requirements
    .map((r) => r.toUpperCase())
    .includes(resourceType.toUpperCase());
}

// ─── Feasibility filter ───────────────────────────────────────────────────────
/**
 * Evaluates a single resource candidate for feasibility.
 *
 * Feasibility rules (all must pass):
 *   1. status must be AVAILABLE
 *   2. type must match at least one incident requirement
 *   3. capacity must be >= incident.affectedPeople
 *
 * Returns a CandidateEvaluation with feasible = true/false and a reason.
 */
function evaluateCandidate(
  resource: ResourceCandidate,
  incidentLat: number,
  incidentLon: number,
  affectedPeople: number,
  requirements: string[],
  averageSpeedKmh: number,
): CandidateEvaluation {
  // Rule 1: availability
  if (resource.status !== 'AVAILABLE') {
    return {
      resourceId: resource.id,
      resourceName: resource.name,
      resourceType: resource.type,
      feasible: false,
      rejectionReason: `Resource is currently ${resource.status}.`,
    };
  }

  // Rule 2: type match
  if (!isTypeMatch(resource.type, requirements)) {
    return {
      resourceId: resource.id,
      resourceName: resource.name,
      resourceType: resource.type,
      feasible: false,
      rejectionReason: `Resource type "${resource.type}" does not match incident requirements [${requirements.join(', ')}].`,
    };
  }

  // Rule 3: capacity
  if (resource.capacity < affectedPeople) {
    return {
      resourceId: resource.id,
      resourceName: resource.name,
      resourceType: resource.type,
      feasible: false,
      rejectionReason: `Resource capacity (${resource.capacity}) is insufficient for ${affectedPeople} affected people.`,
    };
  }

  // Feasible — calculate distance and ETA
  const distanceKm = haversineDistanceKm(
    incidentLat,
    incidentLon,
    resource.latitude,
    resource.longitude,
  );
  const etaMinutes = estimateEtaMinutes(distanceKm, averageSpeedKmh);
  const capacityFit = resource.capacity - affectedPeople;

  return {
    resourceId: resource.id,
    resourceName: resource.name,
    resourceType: resource.type,
    feasible: true,
    estimatedDistanceKm: distanceKm,
    estimatedEtaMinutes: etaMinutes,
    capacityFit,
  };
}

// ─── Greedy ranking ───────────────────────────────────────────────────────────
/**
 * Ranks feasible candidates using a deterministic greedy strategy.
 *
 * Ranking rules (applied in order):
 *   1. Lower ETA wins (primary criterion — minimise response time).
 *   2. Lower capacityFit wins (better fit — avoid assigning an oversized
 *      resource when a smaller one arrives at the same time).
 *   3. Lexicographically smaller resource ID wins (stable, deterministic
 *      tie-breaker — never random).
 *
 * This is a near-optimal, operationally feasible heuristic.
 * It does NOT guarantee a globally optimal solution.
 */
function rankCandidates(
  evaluations: CandidateEvaluation[],
): CandidateEvaluation[] {
  return [...evaluations].sort((a, b) => {
    // 1. ETA
    const etaDiff = (a.estimatedEtaMinutes ?? Infinity) - (b.estimatedEtaMinutes ?? Infinity);
    if (etaDiff !== 0) return etaDiff;

    // 2. Capacity fit (smaller surplus = better fit)
    const fitDiff = (a.capacityFit ?? Infinity) - (b.capacityFit ?? Infinity);
    if (fitDiff !== 0) return fitDiff;

    // 3. Stable ID tie-breaker
    return a.resourceId.localeCompare(b.resourceId);
  });
}

// ─── Main engine ──────────────────────────────────────────────────────────────
/**
 * recommendResource
 *
 * Greedy Resource Allocation Engine.
 *
 * This engine answers: "Which available resource is most suitable right now?"
 *
 * It does NOT:
 *   - Create an assignment
 *   - Reserve or lock the resource
 *   - Change resource status
 *   - Select a hospital
 *
 * Algorithm:
 *   1. Evaluate every resource for feasibility (availability, type, capacity).
 *   2. Compute distance (Haversine) and ETA for feasible resources.
 *   3. Rank feasible resources (lowest ETA → best capacity fit → stable ID).
 *   4. Select the top-ranked resource.
 *   5. Return a full explainable result including rejected candidates.
 */
export function recommendResource(
  input: AllocationEngineInput,
): AllocationResult {
  const {
    incidentId,
    incidentLatitude,
    incidentLongitude,
    affectedPeople,
    resourceRequirements,
    availableResources,
    averageSpeedKmh,
  } = input;

  if (availableResources.length === 0) {
    return {
      incidentId,
      selectedResource: null,
      estimatedDistanceKm: null,
      estimatedEtaMinutes: null,
      reasons: ['No resources exist in the system.'],
      rejectedCandidates: [],
      candidateEvaluations: [],
      message: 'No resources are available in the system.',
    };
  }

  // Step 1 — evaluate all candidates
  const evaluations: CandidateEvaluation[] = availableResources.map((r) =>
    evaluateCandidate(
      r,
      incidentLatitude,
      incidentLongitude,
      affectedPeople,
      resourceRequirements,
      averageSpeedKmh,
    ),
  );

  const feasible = evaluations.filter((e) => e.feasible);
  const rejected = evaluations.filter((e) => !e.feasible);

  const rejectedCandidates = rejected.map((e) => ({
    resourceId: e.resourceId,
    resourceName: e.resourceName,
    reason: e.rejectionReason ?? 'Unknown rejection reason.',
  }));

  // Step 2 — no feasible resources
  if (feasible.length === 0) {
    return {
      incidentId,
      selectedResource: null,
      estimatedDistanceKm: null,
      estimatedEtaMinutes: null,
      reasons: ['No suitable resource is currently available for this incident.'],
      rejectedCandidates,
      candidateEvaluations: evaluations,
      message: 'No suitable resource is currently available.',
    };
  }

  // Step 3 — rank and select best
  const ranked = rankCandidates(feasible);
  const best = ranked[0]!;

  // Find the full resource record for the selected candidate
  const selectedRecord = availableResources.find((r) => r.id === best.resourceId)!;

  const selectedResource = {
    id: selectedRecord.id,
    name: selectedRecord.name,
    type: selectedRecord.type,
    status: selectedRecord.status,
    capacity: selectedRecord.capacity,
    latitude: selectedRecord.latitude,
    longitude: selectedRecord.longitude,
  };

  // Build explainable reasons for the selection
  const reasons: string[] = [
    `Resource "${selectedRecord.name}" is AVAILABLE.`,
    `Resource type "${selectedRecord.type}" matches the incident requirement.`,
    `Resource capacity (${selectedRecord.capacity}) is sufficient for ${affectedPeople} affected people.`,
    `Estimated ETA: ${best.estimatedEtaMinutes} minutes (${best.estimatedDistanceKm} km at ${averageSpeedKmh} km/h — straight-line approximation).`,
  ];

  if (feasible.length > 1) {
    reasons.push(
      `Selected over ${feasible.length - 1} other feasible candidate(s) based on lowest estimated ETA.`,
    );
  }

  return {
    incidentId,
    selectedResource,
    estimatedDistanceKm: best.estimatedDistanceKm ?? null,
    estimatedEtaMinutes: best.estimatedEtaMinutes ?? null,
    reasons,
    rejectedCandidates,
    candidateEvaluations: evaluations,
    message: `Resource "${selectedRecord.name}" recommended for incident.`,
  };
}
