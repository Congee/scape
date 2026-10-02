import { createContext, useContext } from 'react';
import { PanelPage } from '@state/ui';

export const PanelPageContext = createContext<PanelPage>(PanelPage.Map);

/** False inside the viewfinder's panel, where map-only controls do nothing. */
export const useOnMap = () => useContext(PanelPageContext) === PanelPage.Map;
