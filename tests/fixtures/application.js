// Historical UI fixtures keep their in-memory contract while production uses HTTP only.
import { createBase44Adapter } from './legacy-adapter';
import { base44 } from './client';
import { appParams } from './params';
export const application=createBase44Adapter({client:base44,params:appParams});
