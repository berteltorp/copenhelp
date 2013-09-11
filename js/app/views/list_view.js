/* globals window */
var Backbone     = require('backbone'),
    $            = require('jquery'),
    Query        = require('lib/query'),
    _            = require('underscore'),
    facilities   = require('collections/facilities').instance,
    searchParams = ["fr"],
    parseParams  = require('lib/query_param_parser'),
    maps         = require('google-maps'),
    LatLng       = maps.LatLng;

function generateQueryParams(queryString) {
  var params       = parseParams(queryString),
      categories   = _.compact((params.categories || '').split(',')),
      demographics = _.compact((params.demographics || '').split(',')),
      gender       = params.gender || null,
      search       = decodeURIComponent(params.search || ''),
      sort         = params.sort,
      queryParams  = { search: search, limit: 10 },
      filterParams = {};

  if (categories.length > 0) {
    filterParams.categories = categories;
  }

  if (demographics.length > 0) {
    filterParams.age = demographics;
  }

  if (params.gender && params.gender !== 'A') {
    filterParams.gender = params.gender;
  }

  if (params.sort) {
    queryParams.sort = params.sort;
  }

  queryParams.filter = filterParams;

  return queryParams;
}

function validCategory(category) {
  return category && (/[a-z]+/).test(category.toString());
}

function getData($elements, dataAttrName) {
  var result = [];
  $elements.each(function(n, el) {
    result.push($(el).data(dataAttrName));
  });
  return result;
}

function caculateDistanceFromService(serviceJson, currentLocation) {
  var location = serviceJson.location,
      pos1     = new LatLng(currentLocation.lat, currentLocation.lon),
      pos2     = new LatLng(location.latitude, location.longitude),
      distance = maps.geometry.spherical.computeDistanceBetween(pos1, pos2);
  distance = distance/1000*0.62137; // meters to miles
  distance = +distance.toFixed(2); // precision after decimal point
  return distance;
}

var ListView = Backbone.View.extend({
  template: require('templates/list'),

  events: {
    "click #filter-button": 'goToFilter',
    "click #load-more":     'loadMore'
  },

  initialize: function() {
    this.listenTo(this.collection, 'reset', this.render);
  },

  reset: function() {
    this.offset = this.hasMoreResults = null;
  },

  showSpinner: function() {
    this.$('#loading-spinner').show();
  },

  hideSpinner: function() {
    this.$('#loading-spinner').hide();
  },

  submitQuery: function(params, options) {
    options = options || {};
    return Query.submit(params).done(function(results) {
      this.offset = results.offset;
      this.hasMoreResults = (results.data.length == params.limit);

      if (options.appendData) {
        this.collection.add(results.data);
      } else {
        facilities.reset(results.data);
      }

    }.bind(this));
  },

  loadMore: function() {
    $('#loading-spinner').show();
    $('#load-more-container').hide();

    var params = this.getFilterParams();

    this.submitQuery(params, { appendData: true }).done(function(results) {
      $('#loading-spinner').hide();
      this.render();
    }.bind(this));
  },

  goToFilter: function() {
    var router = require('routers/router').instance;
    router.navigate("filter", {trigger: true});
  },

  generateQueryParams: generateQueryParams,

  getFilterParams: function () {
    var queryString  = window.location.hash.substring(window.location.hash.indexOf('?')+1),
        queryParams  = generateQueryParams(queryString);

    queryParams.offset = this.offset;
    queryParams.limit  = 10;

    this.options.categories = queryParams.filter.categories || [];

    return queryParams;
  },

  resetFilters: function() {
    this.$(".query .selected").removeClass("selected");
    var self = this;

    if ( this.options.categories ) { 
      this.options.categories.forEach(function(category) {
        self.$categoryOption(category).addClass("selected");
      });
    }

    this.$(".query-option-gender [data-value='A']").addClass('selected');
  },

  $categoryOption: function(category) {
    if(validCategory(category)) {
      return this.$(".query-option-category [data-value=" + category + "]").addClass("selected");
    } else {
      return $();
    }

  },

  showMore: function(collection, searchLimit) {
    console.log('showMore', collection.length, searchLimit);
    return collection.length >= searchLimit;
  },

  render: function() {
    var deepJson        = this.collection ? this.deepToJson(this.collection) : [],
        categories      = this.options.categories || [],
        currentLocation = this.options.currentLocation || { lat: 37.7823772, lon: -122.40984609999998 },
        loadingResults  = this.options.loadingResults || [],
        templateJson    = this.flattenServices(deepJson, currentLocation);

    // replace with template
    this.$el.html(this.template({
      facilities:     templateJson,
      categories:     ListView.CATEGORIES,
      loadingResults: loadingResults,
      searchParams:   this.filterSelectCategories(categories),
      navButtons: [
        {class: 'left', id: 'backNav-button', text: 'Back'},
        {class: 'right', id: 'filter-button', text: 'Filter'}
      ]
    }));
    this.$('.query').hide();
    this.$('.option-group-exclusive .query-option').click(function() {
      $(this).closest(".option-group-exclusive").find(".query-option").removeClass("selected");
      $(this).toggleClass("selected");
    });

    this.$('.option-group .query-option').click(function() {
      $(this).toggleClass("selected");
    });
    this.$('#backNav-button').click(function(){
      require('routers/router').instance.back();
    });

    if ( this.hasMoreResults ) {
      this.$('#load-more-container').show();
    }

    this.resetFilters();
    return this;
  },

  deepToJson: function(collection) {
    var json = [],
        modelJson;

    json = collection.models.map(function(model) {
      modelJson = model.toJSON();
      modelJson.status = model.status();
      modelJson.services = [];

      model.attributes.services.forEach(function(service) {
        modelJson.services.push(service.toJSON());
      });

      return modelJson;
    });

    return json;
  },

  // transforms category names to a unique array of category objects
  filterSelectCategories: function(queryParams) {
    var match, selectedCategories = [];

    if ( queryParams ) { 
      queryParams.forEach(function(queryName) {
        var match = _.find(ListView.CATEGORIES, function(e){ return e.key == queryName; });
        if (!_.contains(selectedCategories, match)) {
          selectedCategories.push(match);
        }
      });
    }

    return selectedCategories;
  },

  flattenServices: function(jsonArray, currentLocation) {
    var serviceCategories,
        allNotes,
        flattened = [],
        self = this;

    jsonArray.forEach(function(jsonModel) {
      jsonModel.distance = caculateDistanceFromService(jsonModel, currentLocation);
      serviceCategories = [];
      allNotes = [];

      jsonModel.services.forEach(function(jsonService) {
        serviceCategories.push(jsonService.category);
        allNotes.push(jsonService.notes);
      });

      jsonModel.serviceCategories = self.filterSelectCategories(serviceCategories);
      // jsonModel.serviceCategories = serviceCategories.join(', ');
      jsonModel.allNotes = allNotes.join(' ');
      flattened.push(jsonModel);
    });

    return flattened;
  }
});


ListView.CATEGORIES = require('lib/categories');

module.exports = ListView;
