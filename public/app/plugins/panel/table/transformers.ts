///<reference path="../../../headers/common.d.ts" />

import _ from 'lodash';
import moment from 'moment';
import flatten from '../../../core/utils/flatten';
import TimeSeries from '../../../core/time_series2';
import TableModel from '../../../core/table_model';
import kbn from 'app/core/utils/kbn';

var transformers = {};

transformers['timeseries_to_rows'] = {
  description: 'Time series to rows',
  getColumns: function() {
    return [];
  },
  transform: function(data, panel, model) {
    model.columns = [
      {text: 'Time', type: 'date'},
      {text: 'Metric'},
      {text: 'Value'},
    ];

    for (var i = 0; i < data.length; i++) {
      var series = data[i];
      for (var y = 0; y < series.datapoints.length; y++) {
        var dp = series.datapoints[y];
        model.rows.push([dp[1], series.target, dp[0]]);
      }
    }
  },
};

transformers['timeseries_to_columns'] = {
  description: 'Time series to columns',
  getColumns: function() {
    return [];
  },
  transform: function(data, panel, model) {
    model.columns.push({text: 'Time', type: 'date'});

    // group by time
    var points = {};

    for (var i = 0; i < data.length; i++) {
      var series = data[i];
      model.columns.push({text: series.target});

      for (var y = 0; y < series.datapoints.length; y++) {
        var dp = series.datapoints[y];
        var timeKey = dp[1].toString();

        if (!points[timeKey]) {
          points[timeKey] = {time: dp[1]};
          points[timeKey][i] = dp[0];
        } else {
          points[timeKey][i] = dp[0];
        }
      }
    }

    for (var time in points) {
      var point = points[time];
      var values = [point.time];

      for (var i = 0; i < data.length; i++) {
        var value = point[i];
        values.push(value);
      }

      model.rows.push(values);
    }
  }
};

transformers['timeseries_aggregations'] = {
  description: 'Time series aggregations',
  getColumns: function() {
    return [
      {text: 'Avg', value: 'avg'},
      {text: 'Min', value: 'min'},
      {text: 'Max', value: 'max'},
      {text: 'Total', value: 'total'},
      {text: 'Current', value: 'current'},
      {text: 'Count', value: 'count'},
    ];
  },
  transform: function(data, panel, model) {
    var i, y;
    model.columns.push({text: 'Metric'});

    if (panel.columns.length === 0) {
      panel.columns.push({text: 'Avg', value: 'avg'});
    }

    for (i = 0; i < panel.columns.length; i++) {
      model.columns.push({text: panel.columns[i].text});
    }

    for (i = 0; i < data.length; i++) {
      var series = new TimeSeries({
        datapoints: data[i].datapoints,
        alias: data[i].target,
      });

      series.getFlotPairs('connected');
      var cells = [series.alias];

      for (y = 0; y < panel.columns.length; y++) {
        cells.push(series.stats[panel.columns[y].value]);
      }

      model.rows.push(cells);
    }
  }
};

transformers['annotations'] = {
  description: 'Annotations',
  getColumns: function() {
    return [];
  },
  transform: function(data, panel, model) {
    model.columns.push({text: 'Time', type: 'date'});
    model.columns.push({text: 'Title'});
    model.columns.push({text: 'Text'});
    model.columns.push({text: 'Tags'});

    if (!data || data.length === 0) {
      return;
    }

    for (var i = 0; i < data.length; i++) {
      var evt = data[i];
      model.rows.push([evt.min, evt.title, evt.text, evt.tags]);
    }
  }
};

transformers['table'] = {
  description: 'Table',
  getColumns: function(data) {
    if (!data || data.length === 0) {
      return [];
    }
  },
  transform: function(data, panel, model) {
    if (!data || data.length === 0) {
      return;
    }

    // merging series
    var tableColumns = [];
    var tableRows = [];
    var filterColumnIndex = -1;
    var filteringEnabled = panel.filter.column && panel.filter.query && panel.search;
    for (var i = 0; i < data.length; i++){
      if (data[i].type !== 'table') {
        throw {message: 'Query result is not in table format, try using another transform.'};
      }

      var intersection = [];
      for (let k = 0; k < data[i].columns.length; k++) {
        var columnFound = false;
        for (let j = 0; j < tableColumns.length; j++) {
          if (tableColumns[j].text === data[i].columns[k].text) {
            intersection.push([j, k]);
            columnFound = true;
            break;
          }
        }

        if (!columnFound) {
          tableColumns.push(data[i].columns[k]);
          if (filteringEnabled && panel.filter.column.text === data[i].columns[k].text) {
            filterColumnIndex = tableColumns.length - 1;
          }
        }
      }

      var compareByTime = true;
      // remove intersection by Time if other tags/columns applied
      if (intersection.length > 1) {
        compareByTime = false;
        intersection = intersection.splice(1);
      }

      if (tableRows.length === 0) {
        tableRows = data[i].rows;
      } else {
        for (let k = 0; k < data[i].rows.length; k++) {
          for (let j = 0; j < tableRows.length; j++) {
            let clone = _.clone(data[i].rows[k]);
            var equal = true;
            for (let n = intersection.length; n--;) {
              if (tableRows[j][intersection[n][0]] !== clone[intersection[n][1]]) {
                equal = false;
                break;
              } else {
                clone.splice(intersection[n][1], 1);
              }
            }
            if (equal && clone.length) {
              // remove Time from clone if there are other tags in series
              if (!compareByTime) {
                clone = clone.splice(1);
              }
              tableRows[j] = tableRows[j].concat(clone);
              break;
            }
          }
        }
      }
    }

    if (filterColumnIndex !== -1 && filteringEnabled) {
      tableRows = _.filter(tableRows, function(row) {
        return ('' + row[filterColumnIndex]).toLowerCase().match(panel.filter.query.toLowerCase());
      });
    }

    model.columns = tableColumns;
    model.rows = tableRows;
  }
};

transformers['json'] = {
  description: 'JSON Data',
  getColumns: function(data) {
    if (!data || data.length === 0) {
      return [];
    }

    var names: any = {};
    for (var i = 0; i < data.length; i++) {
      var series = data[i];
      if (series.type !== 'docs') {
        continue;
      }

      // only look at 100 docs
      var maxDocs = Math.min(series.datapoints.length, 100);
      for (var y = 0; y < maxDocs; y++) {
        var doc = series.datapoints[y];
        var flattened = flatten(doc, null);
        for (var propName in flattened) {
          names[propName] = true;
        }
      }
    }

    return _.map(names, function(value, key) {
      return {text: key, value: key};
    });
  },
  transform: function(data, panel, model) {
    var i, y, z;
    for (i = 0; i < panel.columns.length; i++) {
      model.columns.push({text: panel.columns[i].text});
    }

    if (model.columns.length === 0) {
      model.columns.push({text: 'JSON'});
    }

    for (i = 0; i < data.length; i++) {
      var series = data[i];

      for (y = 0; y < series.datapoints.length; y++) {
        var dp = series.datapoints[y];
        var values = [];

        if (_.isObject(dp) && panel.columns.length > 0) {
          var flattened = flatten(dp, null);
          for (z = 0; z < panel.columns.length; z++) {
            values.push(flattened[panel.columns[z].value]);
          }
        } else {
          values.push(JSON.stringify(dp));
        }

        model.rows.push(values);
      }
    }
  }
};

function applyAliasing(panel, model){
  if (!panel.styles) {
    return;
  }
  var hash = [];
  for (var i = 0; i < model.columns.length; i++) {
    for (var j = 0; j < panel.styles.length; j++) {
      var regex = kbn.stringToJsRegex(panel.styles[j].pattern);
      if (model.columns[i].text.match(regex)) {
        if (!hash[i]) {
          model.columns[i].alias = panel.styles[j].alias ? model.columns[i].text.replace(regex, panel.styles[j].alias) : '';
          hash[i] = model.columns[i].alias;
        }
      }
    }
  }
}

function transformDataToTable(data, panel) {
  var model = new TableModel();

  if (!data || data.length === 0) {
    return model;
  }

  var transformer = transformers[panel.transform];
  if (!transformer) {
    throw {message: 'Transformer ' + panel.transformer + ' not found'};
  }

  transformer.transform(data, panel, model);
  applyAliasing(panel, model);
  return model;
}

export {transformers, transformDataToTable}
