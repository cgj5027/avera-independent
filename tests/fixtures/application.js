// UI fixtures inject an in-memory application; production uses HTTP only.
import { createFixtureApplication } from './application-adapter';
import { fixtureClient } from './client';
import { appParams } from './params';
export const application=createFixtureApplication({client:fixtureClient,params:appParams});
