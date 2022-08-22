import { makeAddInflectorsPlugin } from 'graphile-utils';

export = makeAddInflectorsPlugin(
  {
    allRows(table) {
      //@ts-ignore
      return this.camelCase(`${this.pluralize(this._singularizedTableName(table))}-collection`);
    },
  },
  true,
);