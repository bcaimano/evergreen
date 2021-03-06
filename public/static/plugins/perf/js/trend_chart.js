// Helper function
// TODO Make it accept (d, i) and return function (FP)
function d3Translate(x, y) {
  if (y === undefined) y = x
  return 'translate(' + x + ',' + y + ')';
}

mciModule.factory('PerfChartService', function() {
  var cfg = {
    container: {
      width: 960,
      height: 222
    },
    margin: {
      top: 12,
      right: 50,
      bottom: 60,
      left: 120
    },
    points: {
      focusedR: 4.5,
      changePointSize: 12,
    },
    valueAttr: 'ops_per_sec',
    yAxis: {
      ticks: 5,
      gap: 10 // White space between axis and chart
    },
    xAxis: {
      maxTicks: 10,
      format: 'MMM DD',
      labelYOffset: 20,
    },
    focus: {
      labelOffset: {
        x: 6,
        y: -5,
        between: 15, // Minimal vertical space between ops labels
      }
    },
    format: {
      date: 'll'
    },
    legend: {
      itemHeight: 20,
      itemWidth: 35,
      gap: 10, // between legen items
      yOffset: 10, // To bootom
      textOverRectOffset: -15, // Aligns legend item with the text label
      yPos: undefined, // To be calculated
      xPos: undefined, // To be calculated
      step: undefined, // to e calculated. Step between legend items
    },
    knownLevels: {
        1: { colorId: 0 },
        2: { colorId: 9 },
        4: { colorId: 1 },
        8: { colorId: 2 },
       16: { colorId: 3 },
       32: { colorId: 4 },
       64: { colorId: 5 },
      128: { colorId: 8 },
      256: { colorId: 6 },
      512: { colorId: 7 },
    },
    formatters: {
      large: d3.format(',.0f'), // grouped thousands, no significant digits
      digits_1: d3.format('.01f'), // floating point 1 digits
      digits_2: d3.format('.02f'), // floating point 2 digits
      digits_3: d3.format('.03f'), // floating point 3 digits
      si: d3.format(',s'), // si notation
    }
  };

  // Non-persistent color id offset for unusual thread level
  cfg.knownLevelsCount = _.keys(cfg.knownLevels).length

  // Chart are real size
  cfg.effectiveWidth = cfg.container.width - cfg.margin.left - cfg.margin.right;
  cfg.effectiveHeight = cfg.container.height - cfg.margin.top - cfg.margin.bottom;

  // Legend y pos
  cfg.legend.yPos = (
    cfg.container.height - cfg.legend.yOffset
    - cfg.legend.itemHeight - cfg.legend.textOverRectOffset
  )

  cfg.legend.step = cfg.legend.itemWidth + cfg.legend.gap

  // Returns list of y-positions of ops labels for given
  // yScaledValues list.
  function getOpsLabelYPosition(vals, cfg) {
    var yScaledValues = _.sortBy(vals, function(d) { return -d })

    // Calculate the most top (the last) label position.
    // Also checks top margin overlap
    var currentVal = _.last(yScaledValues)
    var prevPos = currentVal + cfg.focus.labelOffset.y
    if (prevPos < cfg.margin.top) {
      prevPos = cfg.margin.top + 5
    }
    var textPosList = []
    textPosList[_.indexOf(vals, currentVal)] = prevPos

    // Calculate all other items positions, based on previous item position
    // Loop skips the last item (see code above)
    for (var i = yScaledValues.length - 2; i >= 0; i--) {
      var currentVal = yScaledValues[i]
      var currentPos = currentVal + cfg.focus.labelOffset.y;
      var delta = prevPos - currentPos;
      // If labels overlapping, move the label below previous label
      var newPos = (delta > -cfg.focus.labelOffset.between)
        ? prevPos + cfg.focus.labelOffset.between
        : currentPos
      prevPos = newPos
      textPosList[_.indexOf(vals, currentVal)] = newPos
    }

    return textPosList;
  }

  // Pair for getValueForAllLevels function
  // This curried function returns value for given
  // thread `level` (ignored in this case) and series `item`
  function getValueForMaxOnly() {
    return function(item) {
      return item[cfg.valueAttr]
    }
  }

  // Pair for getValueForMaxOnly function
  // This curried function returns value for given
  // thread `level` and series `item`
  function getValueForAllLevels(level) {
    return function(item) {
      return item.threadResults[level.idx] ?
        item.threadResults[level.idx][cfg.valueAttr] :
        null;
    }
  }

  return {
    cfg: cfg,
    getOpsLabelYPosition: getOpsLabelYPosition,
    getValueForMaxOnly: getValueForMaxOnly,
    getValueForAllLevels: getValueForAllLevels,
  }
})

// TODO Add basic encapsulation to the module
// TODO Create AngularJS directive
var drawSingleTrendChart = function(params) {
  var MAXONLY = 'maxonly';

  // Extract params
  var PerfChartService = params.PerfChartService,
      series = params.series,
      changePoints = params.changePoints,
      key = params.key,
      scope = params.scope,
      containerId = params.containerId,
      compareSamples = params.compareSamples,
      threadMode = params.threadMode,
      linearMode = params.linearMode,
      originMode = params.originMode;

  // Filter out change points which lays outside ot the chart
  var visibleChangePoints = _.filter(changePoints, function(d) {
    return _.findWhere(series, {revision: d.revision})
  })

  var cfg = PerfChartService.cfg;
  document.getElementById(containerId).innerHTML = '';

  var svg = d3.select('#' + containerId)
    .append('svg')
    .attr({
      class: 'series',
      width: cfg.container.width,
      height: cfg.container.height,
    })

  var colors = d3.scale.category10();
  // FIXME Force color range 'initialization'. Might be a bug in d3 3.5.3
  // For some reason, d3 will not give you, let's say, the third color
  // unless you requested 0, 1 and 2 before.
  for (var i = 0; i < cfg.knownLevelsCount; i++) colors(i);

  var ops = _.pluck(series, cfg.valueAttr);
  var opsValues = _.pluck(series, 'ops_per_sec_values');
  var avgOpsPerSec = d3.mean(ops)

  // Currently selcted revision item index
  var currentItemIdx = _.findIndex(series, function(d) {
    return d.task_id == scope.task.id
  })

  var allLevels = _.pluck(series[0].threadResults, 'threadLevel')

  var levelsMeta = threadMode == MAXONLY
    ? [{name: 'MAX', idx: cfg.valueAttr, color: '#484848', isActive: true}]
    : _.map(allLevels, function(d, i) {
      var data = {
        name: d,
        idx: _.indexOf(allLevels, d),
        isActive: true,
      };

      var match = cfg.knownLevels[d];

      data.color = colors(match ? match.colorId : cfg.knownLevelsCount + i)
      return data
    })

  var activeLevels
  var activeLevelNames
  function updateActiveLevels() {
    activeLevels = _.where(levelsMeta, {isActive: true})
    activeLevelNames = _.map(activeLevels, function(d) {
      return '' + d.name
    })
  }

  updateActiveLevels()

  // Array with combinations combinations of {level, changePoint}
  var changePointForLevel = []
  _.each(visibleChangePoints, function(point) {
    var level = _.findWhere(levelsMeta, {name: point.thread_level})
    var levels = level ? [level] : levelsMeta

    _.each(levels, function(level) {
      // Check if there is existing point for this revision/level
      // Mostly for MAXONLY mode
      var existing = _.find(changePointForLevel, function(d) {
        return d.level == level && d.changePoint.revision == point.revision
      })
      // If the point already exists, increase count meta property
      if (existing) {
        existing.count++
      } else {
        changePointForLevel.push({
          level: level,
          changePoint: point,
          count: 1,
        })
      }
    })
  })

  // Calculate legend x pos based on levels
  cfg.legend.xPos = (cfg.container.width - levelsMeta.length * cfg.legend.step) / 2

  // Obtains value extractor fn for given `level` and series `item`
  // The obtained function is curried, so you should call it as fn(level)(item)
  var getValueFor = threadMode == MAXONLY
    ? PerfChartService.getValueForMaxOnly
    : PerfChartService.getValueForAllLevels

  // When there are more than one value in opsValues item
  var hasValues = _.all(opsValues, function(d) {
    return d && d.length > 1
  })

  var compareMax = 0
  if (compareSamples && compareSamples.length) {
    compareMax = _.chain(compareSamples)
      .map(function(d) { return d.maxThroughputForTest(key) })
      .max()
      .value()
  }

  // Calculate X Ticks values
  var idxStep = (series.length / cfg.xAxis.maxTicks + 2) | 0
  var xTicksData = _.filter(series, function(d, i) {
    return i % idxStep == 0
  })

  var xScale = d3.scale.linear()
    .domain([0, ops.length - 1])
    .range([0, cfg.effectiveWidth])

  var yScale = linearMode ? d3.scale.linear() : d3.scale.log()

  function getOpsValues(sample) {
    return _.chain(sample.threadResults)
      .filter(function(d) { // Filter out inactive thread levels
        return _.contains(activeLevelNames, d.threadLevel)
      })
      .pluck(cfg.valueAttr) // Extract thread level values
      .value()
  }

  function calculateYScaleDomain() {
    var flatOpsValues = _.flatten(
      _.map(series, function(d) {
        if (threadMode == MAXONLY) {
          // In maxonly mode levels contain single (max) item
          // Extract just one ops item
          return d[cfg.valueAttr]
        } else {
          return getOpsValues(d)
        }
      })
    )

    var multiSeriesAvg = d3.mean(flatOpsValues)
    var multiSeriesMin = d3.min(flatOpsValues)
    var multiSeriesMax = d3.max(flatOpsValues)

    // Zoomed mode / linear scale is default.
    // If the upper and lower y-axis values are very close to the average (within 10%)
    // add extra padding to the upper and lower bounds of the graph for display.
    var yAxisUpperBound = d3.max([multiSeriesMax, multiSeriesAvg * 1.1]);
    var yAxisLowerBound = originMode ? 0 : d3.min([multiSeriesMin, multiSeriesAvg * .9]);

    // Create a log based scale, remove any 0 values (log(0) is infinity).
    if (!linearMode) {
      if (yAxisUpperBound == 0) {
        yAxisUpperBound = 1e-1;
      }
      if (yAxisLowerBound == 0 ) {
        yAxisLowerBound = multiSeriesMin;
        if (yAxisLowerBound == 0) {
          yAxisLowerBound = 1e-1;
        }
      }
    }

    // We assume values are either all negative or all positive (around 0).
    // If the average is less than 0 then swap values and negate the
    // upper bound.
    if (multiSeriesAvg < 0) {
      if (!linearMode) {
        yAxisUpperBound = -yAxisUpperBound;
      }
      yAxisLowerBound = d3.min([multiSeriesMin, multiSeriesAvg * 1.1]);
    }

    return [yAxisLowerBound, yAxisUpperBound]
  }

  yScale = yScale.clamp(true)
    .range([cfg.effectiveHeight, 0])
    .nice(5)

  function updateYScaleDomain() {
    yScale.domain(calculateYScaleDomain())
  }

  updateYScaleDomain()

  var yAxis = d3.svg.axis()
      .scale(yScale)
      .orient('left')
      .ticks(cfg.yAxis.ticks, function(value) {
        var absolute = Math.abs(value)
        if (absolute == 0) {
          return "0"
        }
        if (absolute < 1) {
          if ( absolute >= .1) {
            return cfg.formatters.digits_1(value);
          } else {
            return cfg.formatters.digits_2(value);
          }
        } else{
          return cfg.formatters.si(value);
        }
      })

  // ## CHART STRUCTURE ##

  // multi line
  var mline = d3.svg.line()
    .x(function(d, i) {
      return xScale(i);
    })
    .y(function(d) {
      return yScale(d);
    });

  if (hasValues) {
    var maxline = d3.svg.line()
      .x(function(d, i) { return xScale(i) })
      .y(function(d) { return yScale(d3.max(d.ops_per_sec_values)) })

    var minline = d3.svg.line()
      .x(function(d, i) { return xScale(i) })
      .y(function(d) { return yScale(d3.min(d.ops_per_sec_values)) })
  }

  // Y Axis
  svg.append('g')
    .attr({
      class: 'y-axis',
      transform: d3Translate(cfg.margin.left - cfg.yAxis.gap, cfg.margin.top)
    })

  function updateYAxis() {
    svg.select('g.y-axis')
      .transition()
      .call(yAxis)
  }

  updateYAxis()

  var getIdx = function(d) { return _.findIndex(series, d) }

  var xTicks = svg.append('svg:g')
    .attr({
      transform: d3Translate(cfg.margin.left, cfg.margin.top)
    })
    .selectAll('g')
    .data(xTicksData)
    .enter()
    .append('svg:g')
    .attr({
      transform: function(d) { return d3Translate(xScale(getIdx(d)), 0) }
    })

  // X Tick date text
  xTicks
    .append('svg:text')
    .attr({
      y: cfg.effectiveHeight + cfg.xAxis.labelYOffset,
      class: 'x-tick-label',
      'text-anchor': 'middle'
    })
    .text(function(d) { return moment(d.startedAt).format(cfg.xAxis.format) })

  // X Tick vertical line
  xTicks
    .append('svg:line')
    .attr({
      class: 'x-tick-line',
      x0: 0,
      x1: 0,
      y1: 0,
      y2: cfg.effectiveHeight
    })

  // Show legend for 'all levels' mode only
  if (threadMode != MAXONLY) {
    var legendG = svg.append('svg:g')
      .attr({
        class: 'legend',
        transform: d3Translate(cfg.legend.xPos, cfg.legend.yPos)
      })

    var legendIter = legendG.selectAll('g')
      .data(levelsMeta)
      .enter()
      .append('svg:g')
      .attr({
        transform: function(d, i) {
          return d3Translate(i * cfg.legend.step, 0)
        }
      })
      .style('cursor', 'pointer')
      .on('click', function(d) {
        d.isActive = !d.isActive
        updateActiveLevels()
        updateYScaleDomain()
        updateYAxis()
        redrawLines()
        redrawLegend()
        redrawRefLines()
        redrawTooltip()
        redrawChangePoints()
      })

    redrawLegend()

    function redrawLegend() {
      legendIter.append('svg:rect')
        .attr({
          y: cfg.legend.textOverRectOffset,
          width: cfg.legend.itemWidth,
          height: cfg.legend.itemHeight,
          fill: function(d) {
            return d.isActive ? d.color : '#666'
          }
        })

      legendIter.append('svg:text')
        .text(function(d) { return d.name })
        .attr({
          x: cfg.legend.itemWidth / 2,
          fill: function(d) { return d.isActive ? 'white' : '#DDD' },
          'text-anchor': 'middle',
        })
    }
  }

  // Chart draw area group
  var chartG = svg.append('svg:g')
    .attr('transform', d3Translate(cfg.margin.left, cfg.margin.top))

  var linesG = chartG.append('g').attr({class: 'lines-g'})

  function redrawLines() {
    var lines = linesG.selectAll('path')
      .data(activeLevels)

    lines
      .transition()
      .attr({
        d: function(level) {
          return mline(_.map(series, getValueFor(level)))
        }
      })
      .style({
        stroke: function(d) { return d.color },
      })

    lines
      .enter()
      .append('path')
      .attr({
        d: function(level) {
          return mline(_.map(series, getValueFor(level)))
        },
      })
      .style({
        stroke: function(d) { return d.color },
      })

    lines.exit().remove()

    // Current revision marker
    var commitCircle = chartG
      .selectAll('circle.current')
      .data(activeLevels)

    commitCircle
      .enter()
      .append('circle')
        .attr({
          class: 'point current',
          cx: xScale(currentItemIdx),
          cy: function(level) {
            return yScale(getValueFor(level)(series[currentItemIdx]))
          },
          r: cfg.points.focusedR + 0.5,
          stroke: function(d) { return d.color },
        })

    commitCircle
      .transition()
      .attr({
        cy: function(level) {
          return yScale(getValueFor(level)(series[currentItemIdx]))
        }
      })

    commitCircle.exit().remove()
  }

  redrawLines()

  if (hasValues) {
    chartG.append('path')
      .data([series])
      .attr({
        class: 'error-line',
        d: maxline
      })

    chartG.append('path')
      .data([series])
      .attr({
        class: 'error-line',
        d: minline
      })
  }

  // TODO This lines should be rewritten from scratch
  function redrawRefLines() {
    if (compareSamples) {
      // Remove group if exists
      chartG.select('g.cmp-lines').remove()
      // Recreate group
      var cmpLinesG = chartG.append('g')
        .attr({class: 'cmp-lines'})

      for(var j=0; j < compareSamples.length; j++) {
        var g = cmpLinesG.append('g')
          .attr('class', 'cmp-' + j)
        var compareSample = compareSamples[j]
        var compareMax = compareSample.maxThroughputForTest(key)

        var values;
        if (threadMode == MAXONLY) {
          var values = [yScale(compareSample.maxThroughputForTest(key))]
        } else {
          var testResult = compareSample.resultForTest(key)
          if (testResult) {
            var values = _.map(activeLevelNames, function(lvl) {
              return yScale(testResult.results[lvl][cfg.valueAttr])
            })
          }
        }

        values = _.filter(values)

        if (values && values.length) {
          g.selectAll('.mean-line')
            .data(values)
            .enter()
            .append('svg:line')
            .attr({
              class: 'mean-line',
              x1: 0,
              x2: cfg.effectiveWidth,
              y1: _.identity,
              y2: _.identity,
              stroke: function() { return d3.rgb(colors(j + 1)).brighter() },
              'stroke-width': '2',
              'stroke-dasharray': '5,5'
            })
        }
      }
    }
  }

  redrawRefLines()

  var changePointsG = chartG.append('g')
    .attr('class', 'g-change-points')

  function redrawChangePoints() {
    // Render change points
    var changePoints = changePointsG.selectAll('g.change-point')
      .data(_.filter(changePointForLevel, function(d) {
        return d.level.isActive
      }))

    changePoints
      .enter()
      .append('g')
        .attr({
          class: 'point change-point',
        })
      .append('path') // Plus sign image for change points
        .attr({
          // plus-sign stroke
          class: 'change-point',
          d: 'M-7,3.5h4v4h6v-4h4v-6h-4v-4h-6v4h-4z',
        }).style({
          fill: function(d) {
            return d.count == 1 ? 'yellow' :
                   d.count == 2 ? 'orange' :
                   'red'
          },
        })

    changePoints
      .attr({
        transform: function(d) {
          var idx = _.findIndex(series, function(sample) {
            return sample && sample.revision == d.changePoint.revision
          })

          return idx > -1 ? d3Translate(
            xScale(idx),
            yScale(getValueFor(d.level)(series[idx]))
          ) : undefined
        },
      })

    changePoints.exit().remove()
  }

  redrawChangePoints()

  // Contains elements for hover behavior
  var focusG = chartG.append('svg:g')
    .style('display', 'none')

  var focusedLine = focusG.append('svg:line')
    .attr({
      class: 'focus-line',
      x1: 0,
      x2: 0,
      y1: cfg.effectiveHeight,
    })

  var enableFocusGroup
  var focusedPointsRef
  var focusedTextRef

  function redrawTooltip() {
    focusG.style('display', 'none')

    var focusedPoints = focusG.selectAll('circle')
      .data(activeLevels)

    focusedPointsRef = focusedPoints
      .attr({
        fill: function(d) { return d3.rgb(d.color).darker() },
      })

    focusedPoints
      .enter()
      .append('svg:circle')
      .attr({
        class: 'focus-point',
        r: cfg.points.focusedR,
        fill: function(d) { return d3.rgb(d.color).darker() },
      })

    focusedPoints.exit().remove()

    var focusedText = focusG.selectAll('text')
      .data(activeLevels)

    focusedTextRef = focusedText
      .attr({
        fill: function(d) { return d3.rgb(d.color).darker(2) },
      })

    focusedText
      .enter()
      .append('svg:text')
      .attr({
        class: 'focus-text',
        x: cfg.focus.labelOffset.x,
        fill: function(d) { return d3.rgb(d.color).darker(2) },
      })

    focusedText.exit().remove()

    // This function could be called just once
    enableFocusGroup = _.once(
      function() {
        focusG.style('display', null)
      }
    )
  }

  redrawTooltip()

  // Overlay to handle hover action
  chartG.append('svg:rect')
    .attr({
      class: 'overlay',
      width: cfg.effectiveWidth,
      height: cfg.effectiveHeight
    })
    .on('mouseover', function() {
      scope.currentHoverSeries = series;
    })
    .on('click', function() {
      scope.locked = !scope.locked
      scope.$digest()
    })
    .on('mousemove', overlayMouseMove)

  function overlayMouseMove() {
    if (scope.locked) return;
    var idx = Math.round(xScale.invert(d3.mouse(this)[0]))
    var d = series[idx]
    var hash = d.revision

    // Reduce number of calls if hash didn't changed
    if (hash != scope.$parent.currentHash) {
      scope.$parent.currentHash = hash;
      scope.$parent.currentHashDate = d.startedAt
      scope.$emit('hashChanged', hash)
      scope.$parent.$digest()
    }
  }

  function focusPoint(hash) {
    var idx = _.findIndex(series, function(d) {
      return d && d.revision == hash
    })
    if (idx == undefined) return;
    var item = series[idx]
    if (!item) return;

    var x = xScale(idx)

    // List of per thread level values for selected item
    var values = threadMode == MAXONLY
      ? [item[cfg.valueAttr]]
      : getOpsValues(item)

    var maxOps = _.max(values);
    // List of dot Y positions
    var yScaledValues = _.map(values, yScale)
    var opsLabelsY = PerfChartService.getOpsLabelYPosition(yScaledValues, cfg);

    focusG.attr('transform', d3Translate(x, 0))

    focusedPointsRef.attr({
      cy: function(d, i) { return yScaledValues[i] },
    })

    focusedTextRef
      .attr({
        y: function(d, i) { return opsLabelsY[i] },
        transform: function(d, i) {
          // transform the hover text location based on the list index
          var x = 0
          if (series) {
            x = (cfg.focus.labelOffset.x + this.getBBox().width) * idx / series.length
          }
          return d3Translate(-x, 0)
        }
      })
      .text(function(d, i) {
        var value = values[i];
        var absolute = Math.abs(value);
        if (absolute == 0) {
          return "0";
        } else if (absolute < 1) {
          if (absolute >= .1) {
            return cfg.formatters.digits_1(value);
          } else if (absolute >= .01) {
            return cfg.formatters.digits_2(value);
          } else {
            return cfg.formatters.digits_3(value);
          }
        } else{
          return cfg.formatters.large(value);
        }
      });

    focusedLine.attr({
      y2: yScale(maxOps),
    })
  }

  scope.$on('hashChanged', function(e, hash) {
    // Make tool tip visible
    enableFocusGroup();
    // Apply new position to tool tip
    focusPoint(hash)
  })
}
