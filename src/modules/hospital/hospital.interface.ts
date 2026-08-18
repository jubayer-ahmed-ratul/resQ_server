export type HospitalStatus = 'OPERATIONAL' | 'LIMITED' | 'CLOSED';

export interface CreateHospitalInput {
  name: string;
  latitude: number;
  longitude: number;
  bedCapacity: number;
  availableBeds: number;
  icuCapacity: number;
  availableICUBeds: number;
  status?: HospitalStatus;
}

export interface UpdateHospitalInput {
  name?: string;
  latitude?: number;
  longitude?: number;
  bedCapacity?: number;
  availableBeds?: number;
  icuCapacity?: number;
  availableICUBeds?: number;
  status?: HospitalStatus;
}

export interface HospitalFilters {
  status?: HospitalStatus;
}
