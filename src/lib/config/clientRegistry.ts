'use client';

const getClientConfig = (key: string, defaultVal?: any) => {
  return localStorage.getItem(key) ?? defaultVal ?? undefined;
};

export const getTheme = () => getClientConfig('theme', 'dark');

export const getAutoMediaSearch = () =>
  getClientConfig('autoMediaSearch', 'true') === 'true';

export const getSystemInstructions = () =>
  getClientConfig('systemInstructions', '');

export const getShowWeatherWidget = () =>
  getClientConfig('showWeatherWidget', 'true') === 'true';

export const getShowNewsWidget = () =>
  getClientConfig('showNewsWidget', 'true') === 'true';

export const getLanguage = () => getClientConfig('language', 'zh');

export const getMeasurementUnit = (): 'Metric' | 'Imperial' => {
  const unit = getClientConfig('measureUnit', 'Metric');
  return unit === 'Imperial' ? 'Imperial' : 'Metric';
};
