export const POST = async (req: Request) => {
  try {
    const body: {
      lat: number;
      lng: number;
      measureUnit: 'Imperial' | 'Metric';
    } = await req.json();

    if (!body.lat || !body.lng) {
      return Response.json(
        {
          message: 'Invalid request.',
        },
        { status: 400 },
      );
    }

    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${body.lat}&longitude=${body.lng}&current=weather_code,temperature_2m,is_day,relative_humidity_2m,wind_speed_10m&timezone=auto${
        body.measureUnit === 'Metric' ? '' : '&temperature_unit=fahrenheit'
      }${body.measureUnit === 'Metric' ? '' : '&wind_speed_unit=mph'}`,
    );

    const data = await res.json();

    if (data.error) {
      console.error(`Error fetching weather data: ${data.reason}`);
      return Response.json(
        {
          message: 'An error has occurred.',
        },
        { status: 500 },
      );
    }

    const weather: {
      temperature: number;
      condition: string;
      humidity: number;
      windSpeed: number;
      icon: string;
      temperatureUnit: 'C' | 'F';
      windSpeedUnit: 'm/s' | 'mph';
    } = {
      temperature: data.current.temperature_2m,
      condition: '',
      humidity: data.current.relative_humidity_2m,
      windSpeed: data.current.wind_speed_10m,
      icon: '',
      temperatureUnit: body.measureUnit === 'Metric' ? 'C' : 'F',
      windSpeedUnit: body.measureUnit === 'Metric' ? 'm/s' : 'mph',
    };

    const code = data.current.weather_code;
    const isDay = data.current.is_day === 1;
    const dayOrNight = isDay ? 'day' : 'night';

    if (code === 0) {
      weather.icon = `clear-${dayOrNight}`;
      weather.condition = 'Clear';
    } else if (code === 1) {
      weather.icon = `clear-${dayOrNight}`;
      weather.condition = 'Mainly Clear';
    } else if (code === 2) {
      weather.icon = `cloudy-1-${dayOrNight}`;
      weather.condition = 'Partly Cloudy';
    } else if (code === 3) {
      weather.icon = `cloudy-1-${dayOrNight}`;
      weather.condition = 'Overcast';
    } else if (code === 45 || code === 48) {
      weather.icon = `fog-${dayOrNight}`;
      weather.condition = 'Fog';
    } else if (code === 51 || code === 53 || code === 55) {
      weather.icon = `rainy-1-${dayOrNight}`;
      weather.condition =
        code === 51 ? 'Light Drizzle' : code === 53 ? 'Moderate Drizzle' : 'Dense Drizzle';
    } else if (code === 56 || code === 57) {
      weather.icon = `frost-${dayOrNight}`;
      weather.condition = code === 56 ? 'Light Freezing Drizzle' : 'Dense Freezing Drizzle';
    } else if (code === 61 || code === 63 || code === 65) {
      weather.icon = `rainy-2-${dayOrNight}`;
      weather.condition = code === 61 ? 'Slight Rain' : code === 63 ? 'Moderate Rain' : 'Heavy Rain';
    } else if (code === 66 || code === 67) {
      weather.icon = 'rain-and-sleet-mix';
      weather.condition = code === 66 ? 'Light Freezing Rain' : 'Heavy Freezing Rain';
    } else if (code === 71 || code === 73 || code === 75) {
      weather.icon = `snowy-2-${dayOrNight}`;
      weather.condition =
        code === 71 ? 'Slight Snow Fall' : code === 73 ? 'Moderate Snow Fall' : 'Heavy Snow Fall';
    } else if (code === 77) {
      weather.icon = `snowy-1-${dayOrNight}`;
      weather.condition = 'Snow';
    } else if (code === 80 || code === 81 || code === 82) {
      weather.icon = `rainy-3-${dayOrNight}`;
      weather.condition =
        code === 80
          ? 'Slight Rain Showers'
          : code === 81
            ? 'Moderate Rain Showers'
            : 'Heavy Rain Showers';
    } else if (code === 85 || code === 86) {
      weather.icon = `snowy-3-${dayOrNight}`;
      weather.condition = code === 85 ? 'Slight Snow Showers' : 'Heavy Snow Showers';
    } else if (code === 95) {
      weather.icon = `scattered-thunderstorms-${dayOrNight}`;
      weather.condition = 'Thunderstorm';
    } else if (code === 96 || code === 99) {
      weather.icon = 'severe-thunderstorm';
      weather.condition = code === 96 ? 'Thunderstorm with Slight Hail' : 'Thunderstorm with Heavy Hail';
    } else {
      weather.icon = `clear-${dayOrNight}`;
      weather.condition = 'Clear';
    }

    return Response.json(weather);
  } catch (err) {
    console.error('An error occurred while getting home widgets', err);
    return Response.json(
      {
        message: 'An error has occurred.',
      },
      {
        status: 500,
      },
    );
  }
};
