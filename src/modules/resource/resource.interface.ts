export type ResourceType = 'AMBULANCE' | 'RESCUE_TEAM' | 'HELICOPTER' | 'OTHER';
export type ResourceStatus =
  | 'AVAILABLE'
  | 'BUSY'
  | 'UNAVAILABLE'
  | 'MAINTENANCE'
  | 'FAILED';

export interface CreateResourceInput {
  name: string;
  type: ResourceType;
  latitude: number;
  longitude: number;
  capacity: number;
  status?: ResourceStatus;
}

export interface UpdateResourceInput {
  name?: string;
  type?: ResourceType;
  latitude?: number;
  longitude?: number;
  capacity?: number;
  status?: ResourceStatus;
}

export interface ResourceFilters {
  type?: ResourceType;
  status?: ResourceStatus;
}
