import {createFixture} from './fixture.mjs';
import {mountPreparation} from './view.mjs';
import {mountSession} from './lifecycle.mjs';
const session=mountSession({window,create:createFixture,mount:fixture=>mountPreparation(document,fixture)});
if(new URL(location.href).searchParams.get('direction')==='B')session.view.setDirection('B');
