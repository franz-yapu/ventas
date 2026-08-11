import { cleanup, render } from '@testing-library/react';
import { afterEach } from 'vitest';

/**
 * Montar un componente en un test, limpiando después.
 *
 * Existe por una razón muy concreta: Testing Library sólo desmonta sola cuando vitest
 * corre con `globals: true`, y aquí no. Sin limpiar, cada `render` deja su árbol colgando
 * del documento y el test siguiente encuentra **dos** botones "Volver" — el suyo y el del
 * anterior. El fallo dice "found multiple elements", que no se parece en nada a la causa,
 * y se pierde un rato entendiendo por qué.
 *
 * Que sea un módulo y no una línea repetida en cada archivo es a propósito: es justo la
 * clase de detalle que el tercer test que alguien escriba va a olvidar.
 *
 *   import { montar } from './montar';
 *   montar(<MiComponente />);
 */
afterEach(cleanup);

export { screen, within, waitFor, fireEvent } from '@testing-library/react';
export { default as userEvent } from '@testing-library/user-event';
export const montar = render;
