import { EventRequest, FacebookAdsApi, UserData } from 'facebook-nodejs-business-sdk';

const accessToken = '';
const pixelId = '';
const client = FacebookAdsApi.init('');

function sendEvent() {
  const request = new EventRequest(accessToken, pixelId);
  const userData = new UserData().setEmail('');
}
