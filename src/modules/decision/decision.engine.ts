import { IncidentSeverity, TimeSensitivity } from '../incident/incident.interface';
import {
  PriorityEngineInput,
  PriorityCalculationResult,
  PriorityFactorResult,
} from './decision.interface';

// ─── Weights ──────────────────────────────────────────────────────────────────
// Must sum to 1.0

const WEIGHTS = {
  severity: 0.30,
  timeSensitivity: 0.25,
  affectedPopulation: 0.20,
  environmentalRisk: 0.15,
  resourceRequirements: 0.10,
} as const;

// ─── Severity scoring ─────────────────────────────────────────────────────────
// Direct enum → score map. Weight: 30%

const SEVERITY_SCORES: Record<IncidentSeverity, number> = {
  LOW: 25,
  MEDIUM: 50,
  HIGH: 75,
  CRITICAL: 100,
};

function scoreSeverity(severity: IncidentSeverity): PriorityFactorResult {
  const normalizedScore = SEVERITY_SCORES[severity];
  const weightedScore = normalizedScore * WEIGHTS.severity;

  const reasonMap: Record<IncidentSeverity, string> = {
    LOW: 'Low severity has a minor impact on priority.',
    MEDIUM: 'Medium severity moderately increases priority.',
    HIGH: 'High severity significantly increases priority.',
    CRITICAL: 'Critical severity greatly increases priority.',
  };

  return {
    rawValue: severity,
    normalizedScore,
    weightedScore,
    reason: reasonMap[severity],
  };
}

// ─── Time sensitivity scoring ─────────────────────────────────────────────────
// Direct enum → score map. Weight: 25%

const TIME_SENSITIVITY_SCORES: Record<TimeSensitivity, number> = {
  LOW: 25,
  MEDIUM: 50,
  HIGH: 75,
  CRITICAL: 100,
};

function scoreTimeSensitivity(timeSensitivity: TimeSensitivity): PriorityFactorResult {
  const normalizedScore = TIME_SENSITIVITY_SCORES[timeSensitivity];
  const weightedScore = normalizedScore * WEIGHTS.timeSensitivity;

  const reasonMap: Record<TimeSensitivity, string> = {
    LOW: 'Low time sensitivity allows for a measured response.',
    MEDIUM: 'Medium time sensitivity requires a timely response.',
    HIGH: 'High time sensitivity requires rapid intervention.',
    CRITICAL: 'Critical time sensitivity demands immediate deployment.',
  };

  return {
    rawValue: timeSensitivity,
    normalizedScore,
    weightedScore,
    reason: reasonMap[timeSensitivity],
  };
}

// ─── Affected population scoring ─────────────────────────────────────────────
// Normalization method:
//   Uses a piecewise linear scale with a hard cap at 200 people.
//
//   0 people      →  0
//   1–10 people   →  linear 5–25
//   11–50 people  →  linear 25–60
//   51–100 people →  linear 60–85
//   101–200 people→  linear 85–100
//   > 200 people  →  capped at 100
//
// Rationale: logarithmic-style growth that reflects real diminishing
// marginal urgency at very large numbers, while still distinguishing
// between small, medium, and large events.
// Weight: 20%

function normalizePopulation(count: number): number {
  if (count <= 0) return 0;
  if (count <= 10) return 5 + (count / 10) * 20;           // 5 → 25
  if (count <= 50) return 25 + ((count - 10) / 40) * 35;   // 25 → 60
  if (count <= 100) return 60 + ((count - 50) / 50) * 25;  // 60 → 85
  if (count <= 200) return 85 + ((count - 100) / 100) * 15; // 85 → 100
  return 100;
}

function scorePopulation(affectedPeople: number): PriorityFactorResult {
  const normalizedScore = Math.round(normalizePopulation(affectedPeople));
  const weightedScore = normalizedScore * WEIGHTS.affectedPopulation;

  let reason: string;
  if (affectedPeople <= 0) {
    reason = 'No reported affected people.';
  } else if (affectedPeople <= 10) {
    reason = `${affectedPeople} affected ${affectedPeople === 1 ? 'person' : 'people'} — small-scale incident.`;
  } else if (affectedPeople <= 50) {
    reason = `${affectedPeople} affected people — moderate-scale incident increases priority.`;
  } else if (affectedPeople <= 100) {
    reason = `${affectedPeople} affected people — large-scale incident significantly increases priority.`;
  } else {
    reason = `${affectedPeople} affected people — mass-casualty scale drives maximum population priority.`;
  }

  return {
    rawValue: affectedPeople,
    normalizedScore,
    weightedScore,
    reason,
  };
}

// ─── Environmental risk scoring ───────────────────────────────────────────────
// Keyword-based deterministic classification of the environmentalCondition
// free-text field.
//
// Classification hierarchy (first match wins):
//   CRITICAL: collapse, explosion, chemical, gas leak, hazmat, toxic,
//             severe flood, major fire, wildfire
//   HIGH:     flood, fire, earthquake, landslide, cyclone, tornado,
//             severe weather, building damage, road blockage
//   MEDIUM:   rain, storm, smoke, traffic, power outage, waterlogging
//   LOW:      clear, normal, no hazard, dry, calm
//   DEFAULT (no condition / unrecognized): MEDIUM (neutral — unknown
//             risk is never assumed to be zero in emergency response)
//
// Weight: 15%

type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

const RISK_SCORES: Record<RiskLevel, number> = {
  LOW: 25,
  MEDIUM: 50,
  HIGH: 75,
  CRITICAL: 100,
};

const CRITICAL_KEYWORDS = [
  'collapse', 'explosion', 'chemical', 'gas leak', 'hazmat',
  'toxic', 'severe flood', 'major fire', 'wildfire', 'nuclear',
];
const HIGH_KEYWORDS = [
  'flood', 'fire', 'earthquake', 'landslide', 'cyclone',
  'tornado', 'severe weather', 'building damage', 'road blockage',
  'heavy rain', 'storm surge',
];
const MEDIUM_KEYWORDS = [
  'rain', 'storm', 'smoke', 'traffic', 'power outage',
  'waterlogging', 'fog', 'wind', 'damaged',
];
const LOW_KEYWORDS = [
  'clear', 'normal', 'no hazard', 'dry', 'calm', 'mild',
];

function classifyEnvironmentalRisk(condition: string | null): RiskLevel {
  if (!condition || condition.trim() === '') return 'MEDIUM'; // neutral default

  const lower = condition.toLowerCase();

  for (const kw of CRITICAL_KEYWORDS) {
    if (lower.includes(kw)) return 'CRITICAL';
  }
  for (const kw of HIGH_KEYWORDS) {
    if (lower.includes(kw)) return 'HIGH';
  }
  for (const kw of MEDIUM_KEYWORDS) {
    if (lower.includes(kw)) return 'MEDIUM';
  }
  for (const kw of LOW_KEYWORDS) {
    if (lower.includes(kw)) return 'LOW';
  }

  // Unrecognized condition — treat as MEDIUM (conservative default)
  return 'MEDIUM';
}

function scoreEnvironmentalRisk(condition: string | null): PriorityFactorResult {
  const riskLevel = classifyEnvironmentalRisk(condition);
  const normalizedScore = RISK_SCORES[riskLevel];
  const weightedScore = normalizedScore * WEIGHTS.environmentalRisk;

  const reasonMap: Record<RiskLevel, string> = {
    LOW: 'Favorable environmental conditions have a low impact on risk.',
    MEDIUM: condition
      ? 'Moderate environmental conditions slightly increase operational risk.'
      : 'Environmental condition unknown — moderate risk assumed by default.',
    HIGH: `Hazardous environmental condition ("${condition}") increases operational risk.`,
    CRITICAL: `Critical environmental hazard ("${condition}") significantly elevates priority.`,
  };

  return {
    normalizedScore,
    weightedScore,
    reason: reasonMap[riskLevel],
  };
}

// ─── Resource requirements scoring ───────────────────────────────────────────
// Each resource type has a base urgency score.
// Final score = average of individual resource scores, capped at 100.
//
// Scoring rationale:
//   HELICOPTER / HAZMAT_UNIT   → 100 (specialized, scarce, high-urgency)
//   RESCUE_TEAM                → 85  (complex deployment)
//   FIRE_TRUCK                 → 80
//   MEDICAL_SUPPORT            → 70  (essential clinical resource)
//   AMBULANCE                  → 60  (common but time-critical)
//   OTHER / default            → 40  (generic resources)
//   No requirements            → 10  (minimal resource demand)
//
// Weight: 10%

const RESOURCE_URGENCY: Record<string, number> = {
  HELICOPTER: 100,
  HAZMAT_UNIT: 100,
  RESCUE_TEAM: 85,
  FIRE_TRUCK: 80,
  MEDICAL_SUPPORT: 70,
  AMBULANCE: 60,
  OTHER: 40,
};

function scoreResourceRequirements(requirements: string[]): PriorityFactorResult {
  if (requirements.length === 0) {
    return {
      rawValue: 0,
      normalizedScore: 10,
      weightedScore: 10 * WEIGHTS.resourceRequirements,
      reason: 'No specific resource requirements — minimal operational demand.',
    };
  }

  const scores = requirements.map(
    (r) => RESOURCE_URGENCY[r.toUpperCase()] ?? RESOURCE_URGENCY['OTHER']!,
  );

  // Average all resource scores, then boost by count (max 1.25x for 5+ resources)
  const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
  const countMultiplier = Math.min(1 + (requirements.length - 1) * 0.05, 1.25);
  const normalizedScore = Math.min(Math.round(avgScore * countMultiplier), 100);
  const weightedScore = normalizedScore * WEIGHTS.resourceRequirements;

  const highUrgency = requirements.filter(
    (r) => (RESOURCE_URGENCY[r.toUpperCase()] ?? 0) >= 85,
  );

  let reason: string;
  if (highUrgency.length > 0) {
    reason = `Specialized resources required (${highUrgency.join(', ')}) increase operational urgency.`;
  } else if (requirements.length >= 3) {
    reason = `Multiple resources required (${requirements.join(', ')}) indicate a complex incident.`;
  } else {
    reason = `Resources required: ${requirements.join(', ')}.`;
  }

  return {
    rawValue: requirements.length,
    normalizedScore,
    weightedScore,
    reason,
  };
}

// ─── Main engine ──────────────────────────────────────────────────────────────

/**
 * calculatePriority
 *
 * Deterministic, explainable heuristic priority engine.
 * Produces a near-optimal operationally feasible priority score (0–100).
 *
 * Formula:
 *   score = severityScore * 0.30
 *         + timeSensitivityScore * 0.25
 *         + populationScore * 0.20
 *         + environmentalScore * 0.15
 *         + resourceScore * 0.10
 *
 * All factor scores are first normalized to 0–100, then weighted.
 * The result is rounded to 2 decimal places and clamped to [0, 100].
 */
export function calculatePriority(
  input: PriorityEngineInput,
): PriorityCalculationResult {
  const severityFactor = scoreSeverity(input.severity);
  const timeFactor = scoreTimeSensitivity(input.timeSensitivity);
  const populationFactor = scorePopulation(input.affectedPeople);
  const environmentalFactor = scoreEnvironmentalRisk(input.environmentalCondition);
  const resourceFactor = scoreResourceRequirements(input.resourceRequirements);

  const rawScore =
    severityFactor.weightedScore +
    timeFactor.weightedScore +
    populationFactor.weightedScore +
    environmentalFactor.weightedScore +
    resourceFactor.weightedScore;

  // Clamp to [0, 100] and round to 2 decimal places
  const priorityScore = Math.min(
    100,
    Math.max(0, Math.round(rawScore * 100) / 100),
  );

  const reasons = [
    severityFactor.reason,
    timeFactor.reason,
    populationFactor.reason,
    environmentalFactor.reason,
    resourceFactor.reason,
  ];

  return {
    priorityScore,
    factors: {
      severity: severityFactor,
      timeSensitivity: timeFactor,
      affectedPopulation: populationFactor,
      environmentalRisk: environmentalFactor,
      resourceRequirements: resourceFactor,
    },
    reasons,
  };
}
