/**
 * Re-optimization Engine
 *
 * Determines whether a current assignment remains feasible and, if not,
 * selects the best replacement using the Part 6 Greedy Allocation Engine.
 *
 * This engine is PURE — it performs no database access.
 * All data is passed in. The service layer handles DB reads/writes.
 *
 * Reuses:
 *   - Part 6: recommendResource() from resource-allocation.engine.ts
 *   - Part 5: calculatePriority() (called from service layer when needed)
 */

import {
  AccessCondition,
  ACCESS_CONDITION_ETA_MULTIPLIER,
  ALLOW_PREEMPTION,
  ReoptimizationTrigger,
} from './reoptimization.interface';
import {
  AllocationEngineInput,
  AllocationResult,
  ResourceCandidate,
} from '../decision/decision.interface';
import { recommendResource } from '../decision/resource-allocation.engine';

// ─── Current assignment feasibility check ─────────────────────────────────────
/**
 * assessCurrentAssignment
 *
 * Evaluates whether the currently assigned resource is still suitable.
 *
 * Key rule: A BUSY resource may be valid if it is BUSY because it is
 * already assigned to THIS incident. The engine does NOT blindly reject
 * every BUSY resource — it checks whether that resource is assigned elsewhere.
 *
 * Parameters:
 *   resourceStatus      — current DB status of the assigned resource
 *   resourceCapacity    — current capacity
 *   affectedPeople      — incident's affected population
 *   requirements        — incident's resource type requirements
 *   resourceType        — the resource's type
 *   isAssignedToThisInc — true if resource's active assignment is for this incident
 *   trigger             — what prompted the re-check
 */
export function assessCurrentAssignment(
  resourceStatus: string,
  resourceCapacity: number,
  affectedPeople: number,
  requirements: string[],
  resourceType: string,
  isAssignedToThisIncident: boolean,
  trigger: ReoptimizationTrigger,
): { feasible: boolean; reason: string | null } {
  // FAILED — always infeasible
  if (resourceStatus === 'FAILED') {
    return { feasible: false, reason: `Resource has FAILED and cannot serve this incident.` };
  }

  // MAINTENANCE — infeasible
  if (resourceStatus === 'MAINTENANCE') {
    return { feasible: false, reason: `Resource is under MAINTENANCE and cannot be deployed.` };
  }

  // UNAVAILABLE — infeasible
  if (resourceStatus === 'UNAVAILABLE') {
    return { feasible: false, reason: `Resource is UNAVAILABLE.` };
  }

  // BUSY — feasible ONLY if busy because of this incident's own assignment
  if (resourceStatus === 'BUSY') {
    if (!isAssignedToThisIncident) {
      return {
        feasible: false,
        reason: `Resource is BUSY serving a different incident — cannot continue serving this one.`,
      };
    }
    // BUSY because of this incident = fine, continue below
  }

  // CAPACITY check — re-check in case affectedPeople increased or capacity dropped
  if (resourceCapacity < affectedPeople) {
    return {
      feasible: false,
      reason: `Resource capacity (${resourceCapacity}) is now insufficient for ${affectedPeople} affected people.`,
    };
  }

  // TYPE check — re-check in case requirements changed
  if (requirements.length > 0) {
    const typeMatch = requirements
      .map((r) => r.toUpperCase())
      .includes(resourceType.toUpperCase());
    if (!typeMatch) {
      return {
        feasible: false,
        reason: `Resource type "${resourceType}" no longer matches incident requirements [${requirements.join(', ')}].`,
      };
    }
  }

  // ACCESS_CONDITION_CHANGE trigger — if the route is BLOCKED the resource
  // cannot reach the incident site (documented limitation: no real routing).
  if (trigger === 'ACCESS_CONDITION_CHANGE') {
    // This is detected at the service layer where accessCondition is provided.
    // If we reach here with this trigger, the service already decided to evaluate;
    // we return feasible=true and let the service apply ETA penalties.
  }

  return { feasible: true, reason: null };
}

// ─── Preemption check ─────────────────────────────────────────────────────────
/**
 * shouldPreempt
 *
 * Determines whether a resource may be taken from its current incident
 * to serve a higher-priority incident.
 *
 * Policy: ALLOW_PREEMPTION controls this globally (default false).
 * If disabled, always returns false — no preemption allowed.
 * If enabled, preemption is allowed when:
 *   1. The competing incident's priority is strictly higher.
 *   2. The priority difference exceeds the minimum threshold (10 points).
 *      (Avoids pointless churn for trivial score differences.)
 */
const PREEMPTION_MIN_PRIORITY_DIFF = 10;

export function shouldPreempt(
  currentIncidentPriority: number,
  competingIncidentPriority: number,
): boolean {
  if (!ALLOW_PREEMPTION) return false;
  return (
    competingIncidentPriority - currentIncidentPriority >= PREEMPTION_MIN_PRIORITY_DIFF
  );
}

// ─── Build alternative candidates list ───────────────────────────────────────
/**
 * buildAlternativeCandidates
 *
 * Prepares the resource candidate list for the Part 6 allocation engine.
 *
 * Exclusions:
 *   - The failing/infeasible resource (excludeResourceIds)
 *   - BLOCKED resources (when access condition = BLOCKED for their route)
 *
 * The Part 6 engine already filters by AVAILABLE status, type, and capacity.
 * This function only needs to exclude specific IDs.
 */
export function buildAlternativeCandidates(
  allResources: ResourceCandidate[],
  excludeResourceIds: string[],
): ResourceCandidate[] {
  const excludeSet = new Set(excludeResourceIds);
  return allResources.filter((r) => !excludeSet.has(r.id));
}

// ─── Run replacement recommendation ──────────────────────────────────────────
/**
 * findReplacementResource
 *
 * Runs the Part 6 Greedy Allocation Engine with the alternative candidate list.
 * Returns the full AllocationResult including rejected candidates and reasons.
 *
 * averageSpeedKmh is divided by the access condition penalty multiplier to
 * model slower travel without modifying the engine itself.
 */
export function findReplacementResource(
  incidentId: string,
  incidentLat: number,
  incidentLon: number,
  affectedPeople: number,
  requirements: string[],
  candidates: ResourceCandidate[],
  averageSpeedKmh: number,
  accessCondition: AccessCondition,
): AllocationResult {
  const multiplier = ACCESS_CONDITION_ETA_MULTIPLIER[accessCondition];
  // If BLOCKED, no resource can reach the incident — return empty
  if (multiplier === Infinity) {
    return {
      incidentId,
      selectedResource: null,
      estimatedDistanceKm: null,
      estimatedEtaMinutes: null,
      reasons: [
        `Access condition is BLOCKED — no resource can be routed to this incident location.`,
        `NOTE: This is a straight-line approximation. Actual route data is not available.`,
      ],
      rejectedCandidates: candidates.map((c) => ({
        resourceId: c.id,
        resourceName: c.name,
        reason: 'Access route to incident is BLOCKED.',
      })),
      candidateEvaluations: [],
      message: 'Access route to incident is BLOCKED. No resource can be dispatched.',
    };
  }

  const effectiveSpeed = averageSpeedKmh / multiplier;

  const engineInput: AllocationEngineInput = {
    incidentId,
    incidentLatitude: incidentLat,
    incidentLongitude: incidentLon,
    affectedPeople,
    resourceRequirements: requirements,
    availableResources: candidates,
    averageSpeedKmh: effectiveSpeed,
  };

  return recommendResource(engineInput);
}

// ─── Export ALLOW_PREEMPTION for service/tests ────────────────────────────────
export { ALLOW_PREEMPTION };
