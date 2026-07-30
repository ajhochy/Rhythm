/* global jest */

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');

  return {
    MaterialCommunityIcons: Text,
  };
});

jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => {
  const { Text } = require('react-native');

  return {
    __esModule: true,
    default: Text,
  };
});
