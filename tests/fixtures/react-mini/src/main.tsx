import { StrictMode } from 'react';
import { routeTree } from './routeTree.gen';
import { missing } from './missing';
import './styles.css';

export const app = <StrictMode>{String(routeTree) + missing}</StrictMode>;
